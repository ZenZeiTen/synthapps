<?php
/**
 * Click list table for fraud review.
 *
 * @package VisitorSentinel
 */

namespace VisitorSentinel\Admin;

use VisitorSentinel\Repository;

defined( 'ABSPATH' ) || exit;

if ( ! class_exists( 'WP_List_Table' ) ) {
	require_once ABSPATH . 'wp-admin/includes/class-wp-list-table.php';
}

/**
 * Lists ad clicks with score, reasons and review actions.
 */
final class Clicks_Table extends \WP_List_Table {

	/**
	 * Constructor.
	 */
	public function __construct() {
		parent::__construct(
			array(
				'singular' => 'click',
				'plural'   => 'clicks',
				'ajax'     => false,
			)
		);
	}

	/**
	 * Columns.
	 *
	 * @return array
	 */
	public function get_columns() {
		return array(
			'cb'          => '<input type="checkbox" />',
			'created_at'  => __( 'Time', 'zenzeiten-visitor-guard' ),
			'click_type'  => __( 'Click', 'zenzeiten-visitor-guard' ),
			'ip'          => __( 'IP', 'zenzeiten-visitor-guard' ),
			'target'      => __( 'Target', 'zenzeiten-visitor-guard' ),
			'fraud_score' => __( 'Score', 'zenzeiten-visitor-guard' ),
			'reasons'     => __( 'Why', 'zenzeiten-visitor-guard' ),
			'status'      => __( 'Status', 'zenzeiten-visitor-guard' ),
		);
	}

	/**
	 * Sortable columns.
	 *
	 * @return array
	 */
	protected function get_sortable_columns() {
		return array(
			'created_at'  => array( 'created_at', true ),
			'fraud_score' => array( 'fraud_score', true ),
		);
	}

	/**
	 * Bulk actions.
	 *
	 * @return array
	 */
	protected function get_bulk_actions() {
		return array(
			'valid' => __( 'Mark as valid', 'zenzeiten-visitor-guard' ),
			'fraud' => __( 'Confirm as fraud', 'zenzeiten-visitor-guard' ),
			'block' => __( 'Block IP', 'zenzeiten-visitor-guard' ),
		);
	}

	/**
	 * Selected filter.
	 *
	 * @return string
	 */
	public function current_filter() {
		$view = isset( $_GET['view'] ) ? sanitize_key( wp_unslash( $_GET['view'] ) ) : 'all'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		return in_array( $view, array( 'all', 'fraud', 'suspicious', 'clean', 'landing', 'onsite', 'activity' ), true ) ? $view : 'all';
	}

	/**
	 * Filter links.
	 *
	 * @return array
	 */
	protected function get_views() {
		$counts  = Repository::instance()->click_view_counts();
		$current = $this->current_filter();
		$labels  = array(
			'all'        => __( 'All ad clicks', 'zenzeiten-visitor-guard' ),
			'fraud'      => __( 'Fraudulent', 'zenzeiten-visitor-guard' ),
			'suspicious' => __( 'Suspicious', 'zenzeiten-visitor-guard' ),
			'clean'      => __( 'Clean', 'zenzeiten-visitor-guard' ),
			'landing'    => __( 'Paid ad visits', 'zenzeiten-visitor-guard' ),
			'onsite'     => __( 'On-site ads', 'zenzeiten-visitor-guard' ),
			'activity'   => __( 'Links & downloads', 'zenzeiten-visitor-guard' ),
		);
		$views   = array();
		foreach ( $labels as $key => $label ) {
			$url           = add_query_arg( 'view', $key, admin_url( 'admin.php?page=vsen-fraud' ) );
			$views[ $key ] = sprintf( '<a href="%1$s"%2$s>%3$s <span class="count">(%4$s)</span></a>', esc_url( $url ), $current === $key ? ' class="current" aria-current="page"' : '', esc_html( $label ), esc_html( number_format_i18n( $counts[ $key ] ) ) );
		}
		return $views;
	}

	/**
	 * Load rows.
	 */
	public function prepare_items() {
		$per_page = 30;
		$page     = $this->get_pagenum();
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- read-only list filters.
		$result = Repository::instance()->list_clicks(
			array(
				'filter'  => $this->current_filter(),
				'search'  => isset( $_REQUEST['s'] ) ? sanitize_text_field( wp_unslash( $_REQUEST['s'] ) ) : '',
				'orderby' => isset( $_GET['orderby'] ) ? sanitize_key( wp_unslash( $_GET['orderby'] ) ) : 'created_at',
				'order'   => isset( $_GET['order'] ) ? sanitize_key( wp_unslash( $_GET['order'] ) ) : 'desc',
				'limit'   => $per_page,
				'offset'  => ( $page - 1 ) * $per_page,
			)
		);
		// phpcs:enable
		$this->items           = $result['rows'];
		$this->_column_headers = array( $this->get_columns(), array(), $this->get_sortable_columns(), 'created_at' );
		$this->set_pagination_args(
			array(
				'total_items' => $result['total'],
				'per_page'    => $per_page,
			)
		);
	}

	/**
	 * Empty message.
	 */
	public function no_items() {
		esc_html_e( 'No clicks in this view yet. Paid ad visits (gclid, msclkid and similar) and clicks on ad elements appear here.', 'zenzeiten-visitor-guard' );
	}

	/**
	 * Checkbox.
	 *
	 * @param object $item Row.
	 * @return string
	 */
	protected function column_cb( $item ) {
		return '<input type="checkbox" name="ids[]" value="' . esc_attr( $item->id ) . '" />';
	}

	/**
	 * Time column with row actions.
	 *
	 * @param object $item Row.
	 * @return string
	 */
	protected function column_created_at( $item ) {
		$html    = esc_html( Admin::local_time( $item->created_at ) );
		$actions = array();
		if ( in_array( $item->click_type, Repository::AD_TYPES, true ) ) {
			if ( 1 !== (int) $item->reviewed ) {
				$actions['valid'] = '<a href="' . esc_url( Admin::action_url( 'click', array( 'verb' => 'valid', 'id' => (int) $item->id ) ) ) . '">' . esc_html__( 'Mark valid', 'zenzeiten-visitor-guard' ) . '</a>';
			}
			if ( 2 !== (int) $item->reviewed ) {
				$actions['fraud'] = '<a href="' . esc_url( Admin::action_url( 'click', array( 'verb' => 'fraud', 'id' => (int) $item->id ) ) ) . '">' . esc_html__( 'Confirm fraud', 'zenzeiten-visitor-guard' ) . '</a>';
			}
		}
		if ( '' !== (string) $item->ip_hash && ! Admin::hash_blocked( $item->ip_hash ) ) {
			$actions['block'] = '<a class="vsen-danger" href="' . esc_url( Admin::action_url( 'click', array( 'verb' => 'block', 'id' => (int) $item->id ) ) ) . '">' . esc_html__( 'Block IP', 'zenzeiten-visitor-guard' ) . '</a>';
		}
		return $html . $this->row_actions( $actions );
	}

	/**
	 * Click type column.
	 *
	 * @param object $item Row.
	 * @return string
	 */
	protected function column_click_type( $item ) {
		$html = esc_html( Admin::click_type_label( $item->click_type ) );
		if ( '' !== (string) $item->network ) {
			$html .= '<br><span class="vsen-muted">' . esc_html( str_replace( '_', ' ', $item->network ) ) . '</span>';
		}
		return $html;
	}

	/**
	 * IP column.
	 *
	 * @param object $item Row.
	 * @return string
	 */
	protected function column_ip( $item ) {
		$label = esc_html( Admin::ip_label( $item->ip, $item->ip_hash ) );
		$html  = (int) $item->visitor_id > 0
			? '<a class="vsen-ip" href="' . esc_url( admin_url( 'admin.php?page=vsen-visitors&visitor=' . (int) $item->visitor_id ) ) . '">' . $label . '</a>'
			: '<span class="vsen-ip">' . $label . '</span>';
		if ( ! empty( $item->country ) ) {
			$html .= ' ' . esc_html( Admin::flag( $item->country ) );
		}
		if ( ! empty( $item->device ) ) {
			$html .= '<br><span class="vsen-muted">' . esc_html( trim( ucfirst( (string) $item->device ) . ' · ' . $item->browser, ' ·' ) ) . '</span>';
		}
		if ( '' !== (string) $item->ip_hash && Admin::hash_blocked( $item->ip_hash ) ) {
			$html .= ' <span class="vsen-pill vsen-pill--fraud">' . esc_html__( 'Blocked', 'zenzeiten-visitor-guard' ) . '</span>';
		}
		return $html;
	}

	/**
	 * Target column.
	 *
	 * @param object $item Row.
	 * @return string
	 */
	protected function column_target( $item ) {
		$target = (string) $item->target;
		$shown  = '' !== $target ? (string) wp_parse_url( $target, PHP_URL_HOST ) . (string) wp_parse_url( $target, PHP_URL_PATH ) : '';
		$html   = '' !== $shown ? '<span class="vsen-url" title="' . esc_attr( $target ) . '">' . esc_html( $shown ) . '</span>' : '';
		if ( '' !== (string) $item->label ) {
			$html .= '<br><span class="vsen-muted">' . esc_html( $item->label ) . '</span>';
		}
		if ( 'ad_click' === $item->click_type && (int) $item->time_to_click >= 0 ) {
			/* translators: %s: seconds */
			$html .= '<br><span class="vsen-muted">' . esc_html( sprintf( __( 'clicked after %ss', 'zenzeiten-visitor-guard' ), number_format_i18n( $item->time_to_click / 1000, 1 ) ) ) . '</span>';
		}
		return $html;
	}

	/**
	 * Score column.
	 *
	 * @param object $item Row.
	 * @return string
	 */
	protected function column_fraud_score( $item ) {
		return in_array( $item->click_type, Repository::AD_TYPES, true ) ? Admin::score_badge( (int) $item->fraud_score ) : '—';
	}

	/**
	 * Reasons column.
	 *
	 * @param object $item Row.
	 * @return string
	 */
	protected function column_reasons( $item ) {
		$reasons = Admin::reason_labels( $item->fraud_reasons );
		if ( empty( $reasons ) ) {
			return '<span class="vsen-muted">—</span>';
		}
		return '<ul class="vsen-reasons"><li>' . implode( '</li><li>', array_map( 'esc_html', $reasons ) ) . '</li></ul>';
	}

	/**
	 * Status column.
	 *
	 * @param object $item Row.
	 * @return string
	 */
	protected function column_status( $item ) {
		return Admin::status_pill( $item );
	}

	/**
	 * Fallback.
	 *
	 * @param object $item        Row.
	 * @param string $column_name Column.
	 * @return string
	 */
	protected function column_default( $item, $column_name ) {
		return isset( $item->$column_name ) ? esc_html( (string) $item->$column_name ) : '';
	}
}
