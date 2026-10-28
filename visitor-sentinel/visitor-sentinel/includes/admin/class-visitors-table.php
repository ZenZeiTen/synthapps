<?php
/**
 * Visitor list table.
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
 * Lists visitors with IP, device, activity counts and fraud score.
 */
final class Visitors_Table extends \WP_List_Table {

	/**
	 * Constructor.
	 */
	public function __construct() {
		parent::__construct(
			array(
				'singular' => 'visitor',
				'plural'   => 'visitors',
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
			'ip'          => __( 'Visitor', 'visitor-sentinel' ),
			'device'      => __( 'Device', 'visitor-sentinel' ),
			'sessions'    => __( 'Sessions', 'visitor-sentinel' ),
			'pageviews'   => __( 'Pageviews', 'visitor-sentinel' ),
			'clicks'      => __( 'Clicks', 'visitor-sentinel' ),
			'fraud_score' => __( 'Fraud score', 'visitor-sentinel' ),
			'first_seen'  => __( 'First seen', 'visitor-sentinel' ),
			'last_seen'   => __( 'Last seen', 'visitor-sentinel' ),
		);
	}

	/**
	 * Sortable columns.
	 *
	 * @return array
	 */
	protected function get_sortable_columns() {
		return array(
			'sessions'    => array( 'sessions', true ),
			'pageviews'   => array( 'pageviews', true ),
			'clicks'      => array( 'clicks', true ),
			'fraud_score' => array( 'fraud_score', true ),
			'first_seen'  => array( 'first_seen', true ),
			'last_seen'   => array( 'last_seen', true ),
		);
	}

	/**
	 * Bulk actions.
	 *
	 * @return array
	 */
	protected function get_bulk_actions() {
		return array(
			'block'   => __( 'Block IP', 'visitor-sentinel' ),
			'unblock' => __( 'Unblock IP', 'visitor-sentinel' ),
		);
	}

	/**
	 * Filter links.
	 *
	 * @return array
	 */
	protected function get_views() {
		$counts  = Repository::instance()->visitor_view_counts();
		$current = $this->current_filter();
		$labels  = array(
			'all'        => __( 'All', 'visitor-sentinel' ),
			'humans'     => __( 'Humans', 'visitor-sentinel' ),
			'bots'       => __( 'Bots', 'visitor-sentinel' ),
			'suspicious' => __( 'Suspicious', 'visitor-sentinel' ),
		);
		$views   = array();
		foreach ( $labels as $key => $label ) {
			$url           = add_query_arg( 'view', $key, admin_url( 'admin.php?page=vsen-visitors' ) );
			$views[ $key ] = sprintf( '<a href="%1$s"%2$s>%3$s <span class="count">(%4$s)</span></a>', esc_url( $url ), $current === $key ? ' class="current" aria-current="page"' : '', esc_html( $label ), esc_html( number_format_i18n( $counts[ $key ] ) ) );
		}
		return $views;
	}

	/**
	 * Selected filter.
	 *
	 * @return string
	 */
	private function current_filter() {
		$view = isset( $_GET['view'] ) ? sanitize_key( wp_unslash( $_GET['view'] ) ) : 'all'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended
		return in_array( $view, array( 'all', 'humans', 'bots', 'suspicious' ), true ) ? $view : 'all';
	}

	/**
	 * Load rows.
	 */
	public function prepare_items() {
		$per_page = 25;
		$page     = $this->get_pagenum();
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- read-only list filters.
		$result = Repository::instance()->list_visitors(
			array(
				'filter'  => $this->current_filter(),
				'search'  => isset( $_REQUEST['s'] ) ? sanitize_text_field( wp_unslash( $_REQUEST['s'] ) ) : '',
				'orderby' => isset( $_GET['orderby'] ) ? sanitize_key( wp_unslash( $_GET['orderby'] ) ) : 'last_seen',
				'order'   => isset( $_GET['order'] ) ? sanitize_key( wp_unslash( $_GET['order'] ) ) : 'desc',
				'limit'   => $per_page,
				'offset'  => ( $page - 1 ) * $per_page,
			)
		);
		// phpcs:enable
		$this->items           = $result['rows'];
		$this->_column_headers = array( $this->get_columns(), array(), $this->get_sortable_columns(), 'ip' );
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
		esc_html_e( 'No visitors recorded yet. Visits appear here as soon as someone opens a page with the tracker.', 'visitor-sentinel' );
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
	 * Visitor column with row actions.
	 *
	 * @param object $item Row.
	 * @return string
	 */
	protected function column_ip( $item ) {
		$link    = admin_url( 'admin.php?page=vsen-visitors&visitor=' . (int) $item->id );
		$blocked = '' !== (string) $item->ip_hash && Admin::hash_blocked( $item->ip_hash );
		$html    = '<strong><a class="vsen-ip" href="' . esc_url( $link ) . '">' . esc_html( Admin::ip_label( $item->ip, $item->ip_hash ) ) . '</a></strong>';
		if ( '' !== (string) $item->country ) {
			$html .= ' <span class="vsen-country" title="' . esc_attr( $item->country ) . '">' . esc_html( Admin::flag( $item->country ) . ' ' . $item->country ) . '</span>';
		}
		if ( (int) $item->is_bot ) {
			$html .= ' <span class="vsen-pill">' . esc_html__( 'Bot', 'visitor-sentinel' ) . '</span>';
		}
		if ( $blocked ) {
			$html .= ' <span class="vsen-pill vsen-pill--fraud">' . esc_html__( 'Blocked', 'visitor-sentinel' ) . '</span>';
		}
		$actions = array(
			'view' => '<a href="' . esc_url( $link ) . '">' . esc_html__( 'View activity', 'visitor-sentinel' ) . '</a>',
		);
		if ( '' !== (string) $item->ip_hash ) {
			$actions['block'] = $blocked
				? '<a href="' . esc_url( Admin::action_url( 'unblock_visitor', array( 'id' => (int) $item->id ) ) ) . '">' . esc_html__( 'Unblock IP', 'visitor-sentinel' ) . '</a>'
				: '<a class="vsen-danger" href="' . esc_url( Admin::action_url( 'block_visitor', array( 'id' => (int) $item->id ) ) ) . '">' . esc_html__( 'Block IP', 'visitor-sentinel' ) . '</a>';
		}
		return $html . $this->row_actions( $actions );
	}

	/**
	 * Device column.
	 *
	 * @param object $item Row.
	 * @return string
	 */
	protected function column_device( $item ) {
		return esc_html( ucfirst( (string) $item->device ) ) . '<br><span class="vsen-muted">' . esc_html( trim( $item->browser . ' · ' . $item->os, ' ·' ) ) . '</span>';
	}

	/**
	 * Fraud score column.
	 *
	 * @param object $item Row.
	 * @return string
	 */
	protected function column_fraud_score( $item ) {
		return Admin::score_badge( (int) $item->fraud_score );
	}

	/**
	 * Other columns.
	 *
	 * @param object $item        Row.
	 * @param string $column_name Column.
	 * @return string
	 */
	protected function column_default( $item, $column_name ) {
		switch ( $column_name ) {
			case 'sessions':
			case 'pageviews':
			case 'clicks':
				return esc_html( number_format_i18n( (int) $item->$column_name ) );
			case 'first_seen':
			case 'last_seen':
				return esc_html( Admin::local_time( $item->$column_name ) );
		}
		return '';
	}
}
