<?php
/**
 * Blocklist and what happens to blocked visitors.
 *
 * @package VisitorSentinel
 */

namespace VisitorSentinel;

defined( 'ABSPATH' ) || exit;

/**
 * Keeps a compact index of the blocklist in an option and enforces the protection action:
 * log only, hide ads from blocked IPs, or refuse the whole site to them.
 */
final class Protection {

	const INDEX_OPTION = 'vsen_block_index';

	/**
	 * Request cache of the index.
	 *
	 * @var array|null
	 */
	private static $index = null;

	/**
	 * Hook into WordPress.
	 */
	public function register() {
		add_action( 'init', array( $this, 'enforce' ), 1 );
		add_action( 'wp_head', array( $this, 'print_head' ), 1 );
		add_shortcode( 'vsen_ad', array( $this, 'shortcode_ad' ) );
	}

	/**
	 * Whether the current visitor is blocked.
	 *
	 * @param Request_Context $ctx Request.
	 * @return bool
	 */
	public static function is_blocked( Request_Context $ctx ) {
		if ( '' === $ctx->ip || $ctx->allowlisted ) {
			return false;
		}
		$index = self::index();
		$now   = time();
		if ( isset( $index['h'][ $ctx->ip_hash ] ) ) {
			$expires = (int) $index['h'][ $ctx->ip_hash ];
			if ( 0 === $expires || $expires > $now ) {
				return true;
			}
		}
		foreach ( $index['r'] as $range ) {
			if ( ( 0 === (int) $range[1] || (int) $range[1] > $now ) && IP::in_range( $ctx->ip, $range[0] ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * The blocklist index: hashes and ranges with their expiry (0 = never).
	 *
	 * @return array
	 */
	public static function index() {
		if ( null === self::$index ) {
			$index       = get_option( self::INDEX_OPTION );
			self::$index = is_array( $index ) && isset( $index['h'], $index['r'] ) ? $index : self::rebuild_index();
		}
		return self::$index;
	}

	/**
	 * Rebuild the index from the table. Call after every blocklist change.
	 *
	 * @return array
	 */
	public static function rebuild_index() {
		$index = array(
			'h' => array(),
			'r' => array(),
		);
		foreach ( (array) Repository::instance()->active_blocks() as $row ) {
			$expires = $row->expires_at ? (int) strtotime( $row->expires_at . ' UTC' ) : 0;
			if ( 'range' === $row->match_type ) {
				$index['r'][] = array( $row->ip_range, $expires );
			} elseif ( '' !== (string) $row->ip_hash ) {
				$index['h'][ $row->ip_hash ] = $expires;
			}
		}
		update_option( self::INDEX_OPTION, $index, true );
		self::$index = $index;
		return $index;
	}

	/**
	 * Block an address or range by hand.
	 *
	 * @param string $value    IP or CIDR range.
	 * @param string $reason   Note.
	 * @param int    $days     Days until it expires, 0 for never.
	 * @return bool|string True, or an error message.
	 */
	public static function block_manual( $value, $reason, $days ) {
		$parsed = IP::parse_range( $value );
		if ( ! $parsed ) {
			return __( 'That is not a valid IP address or CIDR range.', 'visitor-sentinel' );
		}
		$single  = false === strpos( $parsed['canonical'], '/' );
		$expires = $days > 0 ? Repository::now( DAY_IN_SECONDS * (int) $days ) : null;

		if ( $single ) {
			$hash  = Request_Context::hash_ip( $parsed['canonical'] );
			$entry = array(
				'entry_key'  => $hash,
				'match_type' => 'hash',
				'ip_range'   => $parsed['canonical'],
				'ip_hash'    => $hash,
			);
		} else {
			$entry = array(
				'entry_key'  => hash( 'sha256', 'range|' . $parsed['canonical'] ),
				'match_type' => 'range',
				'ip_range'   => $parsed['canonical'],
				'ip_hash'    => '',
			);
		}
		$entry['reason']     = substr( sanitize_text_field( $reason ), 0, 255 );
		$entry['source']     = 'manual';
		$entry['score']      = 0;
		$entry['expires_at'] = $expires;

		Repository::instance()->upsert_block( $entry );
		self::rebuild_index();
		return true;
	}

	/**
	 * Block an IP known only by hash, e.g. from a click or visitor row.
	 *
	 * @param string $ip_hash IP hash.
	 * @param string $display Address as stored (may be masked or empty).
	 * @param string $reason  Reason.
	 * @param string $source  manual or auto.
	 * @param int    $score   Fraud score that triggered it.
	 * @param int    $days    Days until it expires, 0 for never.
	 */
	public static function block_hash( $ip_hash, $display, $reason, $source, $score, $days ) {
		if ( '' === (string) $ip_hash ) {
			return;
		}
		// A masked address stands for its whole network; show it as the range it is.
		if ( 'mask' === Settings::get( 'ip_mode' ) && IP::is_valid( $display ) && false === strpos( (string) $display, '/' ) ) {
			$display = IP::anonymize( $display ) . ( IP::is_v6( $display ) ? '/48' : '/24' );
		}
		Repository::instance()->upsert_block(
			array(
				'entry_key'  => $ip_hash,
				'match_type' => 'hash',
				'ip_range'   => (string) $display,
				'ip_hash'    => $ip_hash,
				'reason'     => substr( (string) $reason, 0, 255 ),
				'source'     => 'auto' === $source ? 'auto' : 'manual',
				'score'      => (int) $score,
				'expires_at' => $days > 0 ? Repository::now( DAY_IN_SECONDS * (int) $days ) : null,
			)
		);
		self::rebuild_index();
	}

	/**
	 * Remove a blocklist entry.
	 *
	 * @param int $id Entry ID.
	 */
	public static function unblock( $id ) {
		Repository::instance()->delete_block( $id );
		self::rebuild_index();
	}

	/**
	 * Remove the block for one IP hash.
	 *
	 * @param string $ip_hash IP hash.
	 */
	public static function unblock_hash( $ip_hash ) {
		Repository::instance()->delete_block_by_hash( $ip_hash );
		self::rebuild_index();
	}

	/**
	 * Refuse the site to blocked visitors when that action is chosen.
	 * Logged-in users who can manage the plugin and the login page are never blocked,
	 * so an administrator cannot lock themselves out.
	 */
	public function enforce() {
		if ( 'block_site' !== Settings::get( 'protection_action' ) || ( defined( 'WP_CLI' ) && WP_CLI ) || wp_doing_cron() ) {
			return;
		}
		if ( current_user_can( Plugin::capability() ) || $this->is_login_request() ) {
			return;
		}
		if ( ! self::is_blocked( Request_Context::current() ) ) {
			return;
		}
		/**
		 * Fires before a blocked visitor is refused.
		 *
		 * @param Request_Context $ctx Request.
		 */
		do_action( 'vsen_blocked_request', Request_Context::current() );
		nocache_headers();
		wp_die(
			esc_html__( 'Access from your network has been restricted because of unusual activity. If you think this is a mistake, please contact the site owner.', 'visitor-sentinel' ),
			esc_html__( 'Access restricted', 'visitor-sentinel' ),
			array( 'response' => 403 )
		);
	}

	/**
	 * Whether this is a login, logout or password request.
	 *
	 * @return bool
	 */
	private function is_login_request() {
		$script = isset( $_SERVER['SCRIPT_NAME'] ) ? sanitize_text_field( wp_unslash( $_SERVER['SCRIPT_NAME'] ) ) : '';
		return false !== strpos( $script, 'wp-login.php' ) || ( function_exists( 'is_login' ) && is_login() );
	}

	/**
	 * Print the ad-hiding CSS and the early flag check in the page head.
	 * The flag check runs before ads load: it reads a flag the tracker stored on an earlier
	 * pageview, so even cached pages hide ads from flagged visitors.
	 */
	public function print_head() {
		if ( 'hide_ads' !== Settings::get( 'protection_action' ) ) {
			return;
		}
		$selectors = Settings::ad_selectors();
		if ( empty( $selectors ) ) {
			return;
		}
		$css = array();
		foreach ( $selectors as $selector ) {
			$css[] = 'html.vsen-flagged ' . $selector;
		}
		$blocked_now = ! is_user_logged_in() && self::is_blocked( Request_Context::current() );

		$script = "try{var f=localStorage.getItem('vsen_f');if(f&&+f>Date.now())document.documentElement.classList.add('vsen-flagged');}catch(e){}";
		if ( $blocked_now ) {
			$script .= "document.documentElement.classList.add('vsen-flagged');";
		}
		echo '<style id="vsen-protect">' . implode( ',', $css ) . '{display:none!important;visibility:hidden!important;pointer-events:none!important}</style>' . "\n"; // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- selectors are validated in Settings::ad_selectors().
		wp_print_inline_script_tag( $script, array( 'id' => 'vsen-flag' ) );
	}

	/**
	 * [vsen_ad label="sidebar"]...ad code...[/vsen_ad]: wraps ad code so its clicks are tracked
	 * and it is hidden from blocked visitors.
	 *
	 * @param array  $atts    Attributes.
	 * @param string $content Ad markup.
	 * @return string
	 */
	public function shortcode_ad( $atts, $content = '' ) {
		$atts = shortcode_atts( array( 'label' => 'ad' ), $atts, 'vsen_ad' );
		if ( 'log_only' !== Settings::get( 'protection_action' ) && ! is_user_logged_in() && self::is_blocked( Request_Context::current() ) ) {
			return '';
		}
		return '<div class="vsen-ad-slot" data-vsen-ad="' . esc_attr( $atts['label'] ) . '">' . do_shortcode( $content ) . '</div>';
	}
}
