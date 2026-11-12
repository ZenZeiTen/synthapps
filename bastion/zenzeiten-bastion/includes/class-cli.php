<?php
/**
 * WP-CLI commands. These work even when the admin area is broken, which makes them the recovery
 * path of last resort: `wp bastion restore <id> --yes`.
 *
 * @package ZenZeiTenBastion
 */

namespace ZenZeiTenBastion;

defined( 'ABSPATH' ) || exit;

/**
 * Manage ZenZeiTen Bastion: backups, restores, blocked addresses and agent lists.
 */
final class CLI {

	/**
	 * Show protection status.
	 *
	 * ## EXAMPLES
	 *
	 *     wp bastion status
	 */
	public function status() {
		$stats = Log::stats();
		$last  = get_option( 'zbst_last_backup', array() );
		\WP_CLI::line( 'Firewall mode:      ' . Settings::get( 'firewall_mode' ) );
		\WP_CLI::line( 'Agent mode:         ' . Settings::get( 'agent_mode' ) );
		\WP_CLI::line( 'Active blocks:      ' . Blocklist::count_active() );
		\WP_CLI::line( 'Blocked (24 hours): ' . $stats['blocked'] );
		\WP_CLI::line( 'Last backup:        ' . ( ! empty( $last['time'] ) ? gmdate( 'Y-m-d H:i', (int) $last['time'] ) . ' UTC (' . $last['id'] . ')' : 'never' ) );
	}

	/**
	 * Create a database backup now.
	 *
	 * ## EXAMPLES
	 *
	 *     wp bastion backup
	 */
	public function backup() {
		$result = Backup::create( 'cli' );
		if ( is_wp_error( $result ) ) {
			\WP_CLI::error( $result->get_error_message() );
		}
		\WP_CLI::success( sprintf( 'Backup %s: %d tables, %d rows, %s.', $result['id'], $result['tables'], $result['rows'], size_format( $result['size'] ) ) );
	}

	/**
	 * List backups, newest first.
	 *
	 * ## OPTIONS
	 *
	 * [--format=<format>]
	 * : table, csv, json or yaml.
	 * ---
	 * default: table
	 * ---
	 *
	 * @subcommand backups
	 * @param array $args       Arguments.
	 * @param array $assoc_args Options.
	 */
	public function backups( $args, $assoc_args ) {
		$rows = array();
		foreach ( Backup::all() as $m ) {
			$rows[] = array(
				'id'      => $m['id'],
				'created' => gmdate( 'Y-m-d H:i', (int) $m['created'] ),
				'trigger' => $m['trigger'],
				'tables'  => $m['tables'],
				'rows'    => $m['rows'],
				'size'    => size_format( $m['size'] ),
			);
		}
		\WP_CLI\Utils\format_items( isset( $assoc_args['format'] ) ? $assoc_args['format'] : 'table', $rows, array( 'id', 'created', 'trigger', 'tables', 'rows', 'size' ) );
	}

	/**
	 * Restore a backup. A safety backup is taken first and restored automatically if anything fails.
	 *
	 * ## OPTIONS
	 *
	 * <id>
	 * : Backup ID from `wp bastion backups`, or "latest".
	 *
	 * [--yes]
	 * : Do not ask for confirmation.
	 *
	 * @param array $args       Arguments.
	 * @param array $assoc_args Options.
	 */
	public function restore( $args, $assoc_args ) {
		$id = $args[0];
		if ( 'latest' === $id ) {
			$all = Backup::all();
			$id  = $all ? $all[0]['id'] : '';
		}
		if ( '' === $id ) {
			\WP_CLI::error( 'There are no backups to restore.' );
		}
		\WP_CLI::confirm( "Replace the database with backup {$id}?", $assoc_args );
		$result = Backup::restore( $id );
		if ( is_wp_error( $result ) ) {
			\WP_CLI::error( $result->get_error_message() );
		}
		\WP_CLI::success( sprintf( 'Restored %s (%d statements). Safety backup: %s.', $id, $result['statements'], $result['safety'] ) );
	}

	/**
	 * Check a backup's checksum and completeness.
	 *
	 * ## OPTIONS
	 *
	 * <id>
	 * : Backup ID.
	 *
	 * @param array $args Arguments.
	 */
	public function verify( $args ) {
		$manifest = Backup::get( $args[0] );
		if ( ! $manifest ) {
			\WP_CLI::error( 'No such backup.' );
		}
		$ok = Backup::verify( $manifest );
		if ( is_wp_error( $ok ) ) {
			\WP_CLI::error( $ok->get_error_message() );
		}
		\WP_CLI::success( 'Backup is complete and unchanged.' );
	}

	/**
	 * Block an address or range.
	 *
	 * ## OPTIONS
	 *
	 * <ip>
	 * : Address or CIDR range.
	 *
	 * [--minutes=<minutes>]
	 * : Length in minutes; 0 (default) blocks permanently.
	 *
	 * [--reason=<reason>]
	 * : Note to keep with the block.
	 *
	 * @param array $args       Arguments.
	 * @param array $assoc_args Options.
	 */
	public function block( $args, $assoc_args ) {
		$minutes = isset( $assoc_args['minutes'] ) ? max( 0, (int) $assoc_args['minutes'] ) : 0;
		$block   = Blocklist::add( $args[0], 'manual', isset( $assoc_args['reason'] ) ? $assoc_args['reason'] : 'Blocked with WP-CLI', $minutes );
		if ( ! $block ) {
			\WP_CLI::error( 'Not a valid address, or it is on the allowlist.' );
		}
		\WP_CLI::success( 'Blocked ' . $block['ip'] . ( $block['expires_at'] ? ' until ' . $block['expires_at'] . ' UTC.' : ' permanently.' ) );
	}

	/**
	 * Lift a block.
	 *
	 * ## OPTIONS
	 *
	 * <ip>
	 * : Address or range as blocked.
	 *
	 * @param array $args Arguments.
	 */
	public function unblock( $args ) {
		if ( ! Blocklist::remove( $args[0] ) ) {
			\WP_CLI::error( 'That address is not blocked.' );
		}
		\WP_CLI::success( 'Unblocked ' . $args[0] . '.' );
	}

	/**
	 * List active blocks.
	 *
	 * ## OPTIONS
	 *
	 * [--format=<format>]
	 * : table, csv, json or yaml.
	 * ---
	 * default: table
	 * ---
	 *
	 * @param array $args       Arguments.
	 * @param array $assoc_args Options.
	 */
	public function blocks( $args, $assoc_args ) {
		\WP_CLI\Utils\format_items( isset( $assoc_args['format'] ) ? $assoc_args['format'] : 'table', Blocklist::active( 1000 ), array( 'ip', 'source', 'reason', 'expires_at', 'hits' ) );
	}

	/**
	 * Agent identity: the address lists of known crawlers and AI agents, and the traps.
	 *
	 * ## OPTIONS
	 *
	 * <action>
	 * : status (list every agent's address list), refresh (fetch the lists now), check (judge an
	 * address and user-agent; writes nothing) or traps (show the trap path and fake key).
	 *
	 * [<ip>]
	 * : For check: the address the request comes from.
	 *
	 * [--ua=<user-agent>]
	 * : For check: the user-agent the request sends.
	 *
	 * [--regenerate]
	 * : For traps: replace the trap path and the fake key.
	 *
	 * [--format=<format>]
	 * : For status: table, json, csv or yaml.
	 *
	 * ## EXAMPLES
	 *
	 *     wp bastion agents status
	 *     wp bastion agents refresh
	 *     wp bastion agents check 66.249.66.1 --ua="Mozilla/5.0 (compatible; Googlebot/2.1)"
	 *     wp bastion agents traps --regenerate
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args Flags.
	 */
	public function agents( $args, $assoc_args ) {
		$action = isset( $args[0] ) ? $args[0] : '';
		if ( 'status' === $action ) {
			$rows = array();
			foreach ( Agents::status() as $row ) {
				$row['refreshed'] = $row['fetched_at'] ? gmdate( 'Y-m-d H:i', $row['fetched_at'] ) . ' UTC' : 'never';
				$row['age_days']  = null === $row['age_days'] ? '' : $row['age_days'];
				$rows[]           = $row;
			}
			\WP_CLI\Utils\format_items( isset( $assoc_args['format'] ) ? $assoc_args['format'] : 'table', $rows, array( 'id', 'agent', 'prefixes', 'refreshed', 'age_days', 'status' ) );
			return;
		}
		if ( 'refresh' === $action ) {
			$failed = 0;
			foreach ( Agents::refresh() as $row ) {
				if ( $row['ok'] ) {
					\WP_CLI::line( sprintf( '%-20s %d prefixes', $row['id'], $row['prefixes'] ) );
				} else {
					++$failed;
					\WP_CLI::warning( $row['id'] . ': ' . $row['error'] . '. The previous copy is kept.' );
				}
			}
			if ( $failed ) {
				\WP_CLI::error( $failed . ' lists could not be refreshed.' );
			}
			\WP_CLI::success( 'Agent lists refreshed.' );
			return;
		}
		if ( 'check' === $action ) {
			if ( empty( $args[1] ) || ! IP::is_valid( $args[1] ) || empty( $assoc_args['ua'] ) ) {
				\WP_CLI::error( 'Usage: wp bastion agents check <ip> --ua=<user-agent>' );
			}
			$info = Agents::identify( IP::normalize( $args[1] ), (string) $assoc_args['ua'] );
			\WP_CLI::line( 'Verdict:  ' . $info['verdict'] );
			\WP_CLI::line( 'Agent:    ' . ( '' !== $info['id'] ? $info['id'] . ' (claims ' . $info['token'] . ')' : 'the user-agent names no known agent' ) );
			\WP_CLI::line( 'List age: ' . ( null === $info['age'] ? 'no list stored' : $info['age'] . ' days' ) );
			return;
		}
		if ( 'traps' === $action ) {
			$traps = empty( $assoc_args['regenerate'] ) ? Agents::traps() : Agents::regenerate_traps();
			\WP_CLI::line( 'Traps:    ' . ( Agents::traps_on() ? 'on' : 'off' ) );
			\WP_CLI::line( 'Trap URL: ' . home_url( $traps['path'] . '/' ) );
			\WP_CLI::line( 'Fake key: ' . $traps['key'] );
			if ( ! empty( $assoc_args['regenerate'] ) ) {
				\WP_CLI::success( 'New trap path and fake key. Clear any page cache so pages carry the new ones.' );
			}
			return;
		}
		\WP_CLI::error( 'Unknown action. Use status, refresh, check or traps.' );
	}
}
