<?php
/**
 * Blocklist table.
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
 * Lists blocked IPs and ranges.
 */
final class Blocklist_Table extends \WP_List_Table {

	/**
	 * Constructor.
	 */
	public function __construct() {
		parent::__construct(
			array(
				'singular' => 'block',
				'plural'   => 'blocks',
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
			'cb'         => '<input type="checkbox" />',
			'ip_range'   => __( 'IP or range', 'zenzeiten-visitor-guard' ),
			'reason'     => __( 'Reason', 'zenzeiten-visitor-guard' ),
			'source'     => __( 'Added', 'zenzeiten-visitor-guard' ),
			'created_at' => __( 'Since', 'zenzeiten-visitor-guard' ),
			'expires_at' => __( 'Expires', 'zenzeiten-visitor-guard' ),
		);
	}

	/**
	 * Bulk actions.
	 *
	 * @return array
	 */
	protected function get_bulk_actions() {
		return array( 'remove' => __( 'Remove', 'zenzeiten-visitor-guard' ) );
	}

	/**
	 * Load rows.
	 */
	public function prepare_items() {
		$per_page = 50;
		$page     = $this->get_pagenum();
		$result   = Repository::instance()->list_blocks(
			array(
				'search' => isset( $_REQUEST['s'] ) ? sanitize_text_field( wp_unslash( $_REQUEST['s'] ) ) : '', // phpcs:ignore WordPress.Security.NonceVerification.Recommended
				'limit'  => $per_page,
				'offset' => ( $page - 1 ) * $per_page,
			)
		);
		$this->items           = $result['rows'];
		$this->_column_headers = array( $this->get_columns(), array(), array(), 'ip_range' );
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
		esc_html_e( 'The blocklist is empty.', 'zenzeiten-visitor-guard' );
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
	 * IP column.
	 *
	 * @param object $item Row.
	 * @return string
	 */
	protected function column_ip_range( $item ) {
		$label   = '' !== (string) $item->ip_range ? $item->ip_range : '#' . substr( (string) $item->ip_hash, 0, 10 );
		$expired = $item->expires_at && strtotime( $item->expires_at . ' UTC' ) <= time();
		$html    = '<strong class="vsen-ip">' . esc_html( $label ) . '</strong>';
		if ( $expired ) {
			$html .= ' <span class="vsen-pill">' . esc_html__( 'Expired', 'zenzeiten-visitor-guard' ) . '</span>';
		}
		$actions = array(
			'remove' => '<a class="vsen-danger" href="' . esc_url( Admin::action_url( 'unblock', array( 'id' => (int) $item->id ) ) ) . '">' . esc_html__( 'Remove', 'zenzeiten-visitor-guard' ) . '</a>',
		);
		return $html . $this->row_actions( $actions );
	}

	/**
	 * Source column.
	 *
	 * @param object $item Row.
	 * @return string
	 */
	protected function column_source( $item ) {
		if ( 'auto' === $item->source ) {
			return '<span class="vsen-pill vsen-pill--suspicious">' . esc_html__( 'Automatically', 'zenzeiten-visitor-guard' ) . '</span> ' . Admin::score_badge( (int) $item->score );
		}
		return '<span class="vsen-pill">' . esc_html__( 'Manually', 'zenzeiten-visitor-guard' ) . '</span>';
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
			case 'reason':
				return esc_html( (string) $item->reason );
			case 'created_at':
				return esc_html( Admin::local_time( $item->created_at ) );
			case 'expires_at':
				return $item->expires_at ? esc_html( Admin::local_time( $item->expires_at ) ) : esc_html__( 'Never', 'zenzeiten-visitor-guard' );
		}
		return '';
	}
}
