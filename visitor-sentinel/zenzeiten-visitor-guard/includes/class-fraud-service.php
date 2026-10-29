<?php
/**
 * Gathers the facts about a click, scores it and acts on the score.
 *
 * @package VisitorSentinel
 */

namespace VisitorSentinel;

defined( 'ABSPATH' ) || exit;

/**
 * Connects the database to the pure Fraud_Engine.
 */
final class Fraud_Service {

	/**
	 * Repository.
	 *
	 * @var Repository
	 */
	private $repo;

	/**
	 * Engine.
	 *
	 * @var Fraud_Engine
	 */
	private $engine;

	/**
	 * Constructor.
	 *
	 * @param Repository|null   $repo   Repository.
	 * @param Fraud_Engine|null $engine Engine.
	 */
	public function __construct( $repo = null, $engine = null ) {
		$this->repo   = $repo ? $repo : Repository::instance();
		$this->engine = $engine ? $engine : new Fraud_Engine( Settings::all() );
	}

	/**
	 * Score a click and store the result. Only ad clicks are scored. A click an administrator
	 * has reviewed keeps the administrator's verdict.
	 *
	 * Scoring is idempotent: every call recomputes from all facts known now, so a click can be
	 * re-scored when engagement arrives and once more when it is finalized.
	 *
	 * @param int  $click_id Click ID.
	 * @param bool $final    Whether this is the last evaluation (missing data now counts against it).
	 * @return array|null Engine result, or null when the click is not scored.
	 */
	public function evaluate( $click_id, $final = false ) {
		$click = $this->repo->get_click( $click_id );
		if ( ! $click || ! in_array( $click->click_type, Repository::AD_TYPES, true ) ) {
			if ( $click && $final ) {
				$this->repo->update_click( $click->id, array( 'finalized' => 1 ) );
			}
			return null;
		}
		if ( (int) $click->reviewed > 0 ) {
			return null;
		}

		$facts  = $this->facts( $click, $final );
		$result = $this->engine->evaluate( $facts );

		/**
		 * Filter a click's fraud result before it is stored.
		 *
		 * @param array  $result score, reasons, status.
		 * @param array  $facts  Facts the score was computed from.
		 * @param object $click  Click row.
		 */
		$result = apply_filters( 'vsen_fraud_result', $result, $facts, $click );

		$update = array(
			'fraud_score'   => max( 0, min( 100, (int) $result['score'] ) ),
			'fraud_reasons' => substr( implode( ',', (array) $result['reasons'] ), 0, 512 ),
			'status'        => (int) $result['status'],
			'evaluated_at'  => Repository::now(),
		);
		if ( $final ) {
			$update['finalized'] = 1;
		}
		$this->repo->update_click( $click->id, $update );

		if ( (int) $click->visitor_id > 0 ) {
			$this->repo->refresh_visitor_score( (int) $click->visitor_id );
		}

		// Block when the score first reaches the threshold, so re-scoring never re-blocks an IP
		// that an administrator has since unblocked.
		$threshold = (int) Settings::get( 'auto_block_threshold' );
		if ( $update['fraud_score'] >= $threshold && (int) $click->fraud_score < $threshold ) {
			$this->maybe_auto_block( $click, $update['fraud_score'], $result['reasons'], $this->signals( $click ) );
		}
		if ( Fraud_Engine::STATUS_FRAUD === (int) $result['status'] && Fraud_Engine::STATUS_FRAUD !== (int) $click->status ) {
			/**
			 * Fires when a click is scored as fraudulent.
			 *
			 * @param object $click  Click row (before this update).
			 * @param array  $result Result.
			 */
			do_action( 'vsen_fraud_detected', $click, $result );
		}

		return $result;
	}

	/**
	 * Every fact the engine needs about one click.
	 *
	 * @param object $click Click row.
	 * @param bool   $final Final evaluation.
	 * @return array
	 */
	public function facts( $click, $final ) {
		$signals = $this->signals( $click );
		$created = (int) strtotime( $click->created_at . ' UTC' );
		$at      = function ( $seconds ) use ( $created ) {
			return gmdate( 'Y-m-d H:i:s', $created - $seconds );
		};

		$facts = array(
			'type'            => $click->click_type,
			'allowlisted'     => ! empty( $signals['al'] ),
			'bot'             => ! empty( $signals['bot'] ),
			'headless'        => ! empty( $signals['hl'] ) || ! empty( $signals['wd'] ),
			'network'         => ! empty( $signals['net'] ),
			'rate_limited'    => ! empty( $signals['rl'] ),
			'missing_headers' => ! empty( $signals['mh'] ),
			'blocked'         => ! empty( $signals['blk'] ),
			'click_id_replay' => ! empty( $signals['rep'] ),
			'iframe'          => ! empty( $signals['ifr'] ),
			'time_to_click'   => (int) $click->time_to_click,
			'interactions'    => isset( $signals['it'] ) ? (int) $signals['it'] : -1,
		);
		if ( isset( $signals['tr'] ) ) {
			$facts['trusted'] = (int) $signals['tr'];
		}

		if ( '' !== (string) $click->ip_hash ) {
			$facts['ip_clicks_1h']  = $this->repo->count_ip_ad_clicks( $click->ip_hash, $at( HOUR_IN_SECONDS ), (int) $click->id );
			$facts['ip_clicks_24h'] = $this->repo->count_ip_ad_clicks( $click->ip_hash, $at( DAY_IN_SECONDS ), (int) $click->id );
			$facts['visitors_24h']  = $this->repo->count_visitors_on_ip( $click->ip_hash, $at( DAY_IN_SECONDS ) );
		}

		if ( 'ad_click' === $click->click_type ) {
			$facts['same_target'] = $this->repo->count_same_target( $click, $at( 10 * MINUTE_IN_SECONDS ) );
		}

		if ( 'ad_landing' === $click->click_type ) {
			$facts['no_js'] = $final && (int) $click->server_seen && ! (int) $click->js_confirmed;
			$facts['dwell'] = -1;
			if ( (int) $click->session_id > 0 ) {
				$engagement                 = $this->repo->session_engagement( (int) $click->session_id );
				$facts['session_pageviews'] = $engagement['pageviews'];
				$facts['interactions']      = $engagement['interactions'];
				// Dwell counts once the browser reported engagement, or at the final check when it never did.
				if ( $engagement['time'] > 0 || $engagement['interactions'] > 0 || $final ) {
					$facts['dwell'] = $engagement['time'];
				}
			}
		}

		/**
		 * Filter the facts before a click is scored. Add your own signals here.
		 *
		 * @param array  $facts Facts.
		 * @param object $click Click row.
		 */
		return apply_filters( 'vsen_fraud_facts', $facts, $click );
	}

	/**
	 * Decode a click's stored signals.
	 *
	 * @param object $click Click row.
	 * @return array
	 */
	private function signals( $click ) {
		$signals = json_decode( (string) $click->signals, true );
		return is_array( $signals ) ? $signals : array();
	}

	/**
	 * Add the click's IP to the blocklist when automatic blocking applies.
	 *
	 * @param object $click   Click row.
	 * @param int    $score   Score.
	 * @param array  $reasons Rule IDs.
	 * @param array  $signals Stored signals.
	 */
	private function maybe_auto_block( $click, $score, $reasons, $signals ) {
		if ( ! Settings::get( 'auto_block' ) ) {
			return;
		}
		// Never auto-block allowlisted IPs or search and ad platform crawlers.
		if ( ! empty( $signals['al'] ) || ! empty( $signals['good'] ) || '' === (string) $click->ip_hash ) {
			return;
		}
		$labels = Fraud_Engine::labels();
		$first  = isset( $reasons[0], $labels[ $reasons[0] ] ) ? $labels[ $reasons[0] ] : '';
		/* translators: 1: fraud score, 2: main reason */
		$reason = sprintf( __( 'Automatic: score %1$d. %2$s', 'zenzeiten-visitor-guard' ), $score, $first );
		Protection::block_hash( $click->ip_hash, $click->ip, $reason, 'auto', $score, (int) Settings::get( 'block_duration_days' ) );
	}
}
