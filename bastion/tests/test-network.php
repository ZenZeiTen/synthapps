<?php
/**
 * Network owner and country lookups, and the labels of the live feed.
 *
 * DNS answers come from zbst_fake_dns() and registry answers from WP_Stub::$http; nothing touches
 * the network.
 *
 * @package ZenZeiTenBastion
 */

// phpcs:disable

use ZenZeiTenBastion\Admin\Admin;
use ZenZeiTenBastion\Log;
use ZenZeiTenBastion\Network;
use ZenZeiTenBastion\Settings;

const ZBST_DNS_GOOGLE = array(
	'8.8.8.8.origin.asn.cymru.com' => '15169 | 8.8.8.0/24 | US | arin | 1992-12-01',
	'AS15169.asn.cymru.com'        => '15169 | US | arin | 2000-03-30 | GOOGLE, US',
);

function test_network_cymru_names() {
	check_same( '8.8.4.8.origin.asn.cymru.com', Network::cymru_name( '8.4.8.8' ) );
	check_same(
		'8.8.8.8.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.0.6.8.4.0.6.8.4.1.0.0.2.origin6.asn.cymru.com',
		Network::cymru_name( '2001:4860:4860::8888' )
	);
}

function test_network_lookup_owner_and_country() {
	$asked = zbst_fake_dns( ZBST_DNS_GOOGLE );
	check_same( array( 'owner' => 'GOOGLE', 'country' => 'US', 'asn' => 15169 ), Network::lookup( '8.8.8.8' ) );
	check_same( 2, count( $asked ) );
	check_same( 0, count( WP_Stub::$requests ), 'the registries are asked only when DNS gives nothing' );

	// The answer is remembered: no second lookup, also after the per-request copy is gone.
	Network::reset();
	check_same( 'GOOGLE', Network::lookup( '8.8.8.8' )['owner'] );
	check_same( 'GOOGLE', Network::known( '8.8.8.8' )['owner'] );
	check_same( 2, count( $asked ) );

	// After 30 days it is asked for again.
	$stored = get_option( Network::OPTION );
	$stored['8.8.8.8']['time'] = time() - Network::KEEP_SECONDS - 10;
	update_option( Network::OPTION, $stored );
	Network::reset();
	check( false === Network::known( '8.8.8.8' ) );
	Network::lookup( '8.8.8.8' );
	check_same( 4, count( $asked ) );
}

function test_network_cymru_edge_cases() {
	zbst_fake_dns(
		array(
			// Announced by two networks: the first is used. The owner name keeps its own commas.
			'1.2.0.192.origin.asn.cymru.com'   => '64500 64501 | 192.0.2.0/24 | ID | apnic | 2010-01-01',
			'AS64500.asn.cymru.com'            => '64500 | ID | apnic | 2010-01-01 | TELKOMNET-AS-AP PT Telekomunikasi Indonesia, Tbk, ID',
			// No name for the network number: the number itself is shown.
			'9.113.0.203.origin.asn.cymru.com' => '64999 | 203.0.113.0/24 | sg | apnic | 2011-01-01',
			// An answer in an unexpected shape is not trusted.
			'5.100.51.198.origin.asn.cymru.com' => 'NA | NA',
		)
	);
	check_same( array( 'owner' => 'TELKOMNET-AS-AP PT Telekomunikasi Indonesia, Tbk', 'country' => 'ID', 'asn' => 64500 ), Network::lookup( '192.0.2.1' ) );
	check_same( array( 'owner' => 'AS64999', 'country' => 'SG', 'asn' => 64999 ), Network::lookup( '203.0.113.9' ) );
	check( null === Network::lookup( '198.51.100.5' ) );
	// IPv6 goes to the IPv6 name.
	$asked = zbst_fake_dns( array() );
	Network::lookup( '2606:4700::1111' );
	check( false !== strpos( $asked[0], '.origin6.asn.cymru.com' ), $asked[0] );
}

function test_network_falls_back_to_the_registry() {
	zbst_fake_dns( array() );
	// ARIN's shape: the owner is the registrant's name; there is no country field.
	WP_Stub::$http['https://rdap.org/ip/8.8.8.8'] = array(
		200,
		json_encode(
			array(
				'name'     => 'GOGL',
				'entities' => array(
					array( 'roles' => array( 'abuse' ), 'vcardArray' => array( 'vcard', array( array( 'fn', array(), 'text', 'Abuse Desk' ) ) ) ),
					array( 'roles' => array( 'registrant' ), 'vcardArray' => array( 'vcard', array( array( 'version', array(), 'text', '4.0' ), array( 'fn', array(), 'text', 'Google LLC' ) ) ) ),
				),
			)
		),
	);
	check_same( array( 'owner' => 'Google LLC', 'country' => '', 'asn' => 0 ), Network::lookup( '8.8.8.8' ) );
	check_same( 4, WP_Stub::$requests[0][1]['timeout'] );

	// APNIC's shape: a range name and a country.
	WP_Stub::$http['https://rdap.org/ip/36.68.1.1'] = array( 200, json_encode( array( 'name' => 'TLKM_BB_SERVICE', 'country' => 'id' ) ) );
	check_same( array( 'owner' => 'TLKM_BB_SERVICE', 'country' => 'ID', 'asn' => 0 ), Network::lookup( '36.68.1.1' ) );

	// Nothing anywhere: remembered as a miss for six hours, then asked again.
	WP_Stub::$http['https://rdap.org/ip/9.9.9.9'] = array( 404, '' );
	check( null === Network::lookup( '9.9.9.9' ) );
	check( null === Network::known( '9.9.9.9' ) );
	$requests = count( WP_Stub::$requests );
	check( null === Network::lookup( '9.9.9.9' ) );
	check_same( $requests, count( WP_Stub::$requests ), 'a miss is not asked for again at once' );
	$stored = get_option( Network::OPTION );
	$stored['9.9.9.9']['time'] = time() - Network::MISS_SECONDS - 10;
	update_option( Network::OPTION, $stored );
	Network::reset();
	check( false === Network::known( '9.9.9.9' ) );
	foreach ( array( 'not json', '[]', '{"country":"Indonesia"}', '{"name":["x"]}' ) as $n => $bad ) {
		WP_Stub::$http[ 'https://rdap.org/ip/9.9.9.' . ( 10 + $n ) ] = array( 200, $bad );
		check( null === Network::lookup( '9.9.9.' . ( 10 + $n ) ), 'accepted ' . $bad );
	}
}

function test_network_skips_private_addresses_and_obeys_the_setting() {
	$asked = zbst_fake_dns( ZBST_DNS_GOOGLE );
	foreach ( array( '127.0.0.1', '10.1.2.3', '192.168.1.10', '172.16.0.1', '169.254.1.1', '::1', 'fc00::1', 'fe80::1', '100.64.0.1', '224.0.0.1', '255.255.255.255', '0.0.0.0', 'ff02::1', 'nonsense', '' ) as $ip ) {
		check( null === Network::lookup( $ip ), 'looked up ' . $ip );
	}
	check_same( 0, count( $asked ) );
	check_same( 0, count( WP_Stub::$requests ) );
	check( false === get_option( Network::OPTION ), 'nothing is stored for them' );

	zbst_set( array( 'ip_lookup' => 0 ) );
	check( null === Network::lookup( '8.8.8.8' ) );
	check_same( array(), Admin::networks( '8.8.8.8' ) );
	check_same( 0, count( $asked ), 'nothing leaves the site while lookups are off' );
	check_same( 1, Settings::defaults()['ip_lookup'] );
	check_same( 0, Settings::sanitize( array() )['ip_lookup'] );
	check_same( 1, Settings::sanitize( array( 'ip_lookup' => '1' ) )['ip_lookup'] );
}

function test_network_memory_is_bounded() {
	$stored = array();
	for ( $i = 0; $i < Network::MAX_ENTRIES; $i++ ) {
		$stored[ '100.64.' . intdiv( $i, 250 ) . '.' . ( $i % 250 ) ] = array( 'owner' => 'X', 'country' => 'US', 'asn' => 1, 'time' => time() );
	}
	update_option( Network::OPTION, $stored );
	Network::reset();
	zbst_fake_dns( ZBST_DNS_GOOGLE );
	Network::lookup( '8.8.8.8' );
	$stored = get_option( Network::OPTION );
	check_same( Network::MAX_ENTRIES, count( $stored ) );
	check( isset( $stored['8.8.8.8'] ) && ! isset( $stored['100.64.0.0'] ), 'the oldest entry made room' );
	// An owner name is clipped, and a country that is not two letters is dropped.
	zbst_fake_dns( array( '1.1.1.1.origin.asn.cymru.com' => '13335 | 1.1.1.0/24 | USA | arin | 2010', 'AS13335.asn.cymru.com' => '13335 | USA | arin | 2010 | ' . str_repeat( 'N', 300 ) ) );
	$found = Network::lookup( '1.1.1.1' );
	check_same( 80, strlen( $found['owner'] ) );
	check_same( '', $found['country'] );
}

function test_live_feed_networks_are_looked_up_a_few_at_a_time() {
	WP_Stub::$user = (object) array( 'ID' => 1, 'roles' => array( 'administrator' ) );
	$dns           = array();
	foreach ( array( 1, 2, 3, 4 ) as $n ) {
		$dns[ $n . '.0.0.20.origin.asn.cymru.com' ] = '6450' . $n . ' | 20.0.0.0/24 | US | arin | 2010';
		$dns[ 'AS6450' . $n . '.asn.cymru.com' ]     = '6450' . $n . ' | US | arin | 2010 | NET' . $n . ', US';
	}
	zbst_fake_dns( $dns );
	$list = '20.0.0.1, 20.0.0.2,20.0.0.3,20.0.0.4,10.0.0.1,junk,20.0.0.1';
	$first = Admin::networks( $list );
	check_same( array( '20.0.0.1', '20.0.0.2', '10.0.0.1' ), array_keys( $first ), 'two fresh lookups per poll; a private address is answered at once' );
	check_same( 'NET1', $first['20.0.0.1']['owner'] );
	check( null === $first['10.0.0.1'] );
	// The next poll gets the remembered ones for free and two more.
	$second = Admin::networks( $list );
	check_same( array( '20.0.0.1', '20.0.0.2', '20.0.0.3', '20.0.0.4', '10.0.0.1' ), array_keys( $second ) );

	// The live endpoint carries them.
	$data = ( new Admin() )->live( new WP_REST_Request( array( 'after' => 0, 'nets' => '20.0.0.3' ) ) )->get_data();
	check_same( array( '20.0.0.3' => array( 'owner' => 'NET3', 'country' => 'US', 'asn' => 64503 ) ), $data['networks'] );
	check_same( array(), ( new Admin() )->live( new WP_REST_Request( array( 'after' => 0 ) ) )->get_data()['networks'] );
}

function test_live_feed_event_labels() {
	zbst_fake_dns( ZBST_DNS_GOOGLE );
	Network::lookup( '8.8.8.8' );
	// The administrator looking at the feed is at 203.0.113.10 (the test default).
	$rows = array(
		'blocked' => array( 'ip' => '8.8.8.8', 'type' => 'firewall', 'severity' => Log::SEVERITY_CRITICAL, 'action' => 'blocked', 'rule' => 'sqli-union' ),
		'locked'  => array( 'ip' => '198.51.100.7', 'type' => 'auto_block', 'severity' => Log::SEVERITY_HIGH, 'action' => 'locked', 'score' => 0 ),
		'logged'  => array( 'ip' => '198.51.100.7', 'type' => 'agent_spoof', 'severity' => Log::SEVERITY_HIGH, 'action' => 'logged' ),
		'failed'  => array( 'ip' => '198.51.100.7', 'type' => 'login_failed', 'severity' => Log::SEVERITY_MEDIUM ),
		'other'   => array( 'ip' => '198.51.100.7', 'type' => 'login_ok', 'severity' => Log::SEVERITY_LOW, 'score' => 0 ),
		'mine'    => array( 'ip' => '203.0.113.10', 'type' => 'login_ok', 'severity' => Log::SEVERITY_LOW, 'score' => 0 ),
		'system'  => array( 'ip' => '', 'type' => 'backup', 'severity' => Log::SEVERITY_LOW, 'score' => 0 ),
	);
	$events = array();
	foreach ( $rows as $name => $row ) {
		Log::add( $row );
		$events[ $name ] = Admin::event_for_js( Log::query( array(), 1, 0 )[0] );
	}
	$outcomes = array();
	foreach ( $events as $name => $event ) {
		$outcomes[ $name ] = $event['result'] . '/' . $event['outcome'];
	}
	check_same(
		array( 'blocked' => 'blocked/Blocked', 'locked' => 'blocked/Blocked', 'logged' => 'logged/Logged', 'failed' => 'logged/Logged', 'other' => 'allow/Allow', 'mine' => 'allow/Allow', 'system' => 'logged/Logged' ),
		$outcomes
	);
	check_same( array( 'mine' ), array_keys( array_filter( array_column( $events, 'own' ) ? array_combine( array_keys( $events ), array_column( $events, 'own' ) ) : array() ) ), 'only the viewer\'s own address is marked' );
	check_same( array( 'owner' => 'GOOGLE', 'country' => 'US', 'asn' => 15169 ), $events['blocked']['net'], 'a remembered owner travels with the event' );
	check( false === $events['other']['net'], 'an address not looked up yet is marked for a lookup' );
	check( null === $events['system']['net'] );
	check_same( 'Info', $events['mine']['level'] );

	// With lookups off, events ask for nothing.
	zbst_set( array( 'ip_lookup' => 0 ) );
	check( null === Admin::event_for_js( Log::query( array( 'ip' => '198.51.100.7' ), 1, 0 )[0] )['net'] );
}

function test_views_show_action_labels() {
	zbst_request( '198.51.100.7', array( 'id' => '1 UNION SELECT 1' ) );
	check_same( 403, zbst_run_guard() );
	// Administrators are not inspected, so the viewer signs in after the attack.
	WP_Stub::$user = (object) array( 'ID' => 1, 'roles' => array( 'administrator' ) );
	Log::add( array( 'ip' => '198.51.100.8', 'type' => 'login_ok', 'severity' => Log::SEVERITY_LOW, 'score' => 0 ) );
	$html = zbst_render( array( new Admin(), 'page_dashboard' ) );
	check_same( 6, substr_count( substr( $html, strpos( $html, 'zbst-feed' ), 900 ), '<th>' ), 'the feed has an Action column' );
	check( false !== strpos( $html, '"outcome":"Blocked"' ) && false !== strpos( $html, '"outcome":"Allow"' ), 'the feed data carries the labels' );
	$html = zbst_render( array( new Admin(), 'page_events' ) );
	check( false !== strpos( $html, '<td>Blocked</td>' ) && false !== strpos( $html, '<td>Allow</td>' ), 'the attack log uses the same words' );
	check( false === strpos( $html, '<td>blocked</td>' ) );
	$html = zbst_render( array( new Admin(), 'page_settings' ) );
	check( false !== strpos( $html, 'name="zbst[ip_lookup]"' ) && false !== strpos( $html, 'rdap.org' ) );
}

function test_cli_network_command() {
	zbst_fake_dns( ZBST_DNS_GOOGLE );
	$cli = new ZenZeiTenBastion\CLI();
	WP_CLI::$out = array();
	$cli->network( array( '8.8.8.8' ) );
	check_same( array( 'Owner:   GOOGLE (AS15169)', 'Country: US' ), WP_CLI::$out );
	foreach ( array( array( 'junk' ), array( '10.0.0.1' ), array() ) as $args ) {
		$failed = false;
		try {
			$cli->network( $args );
		} catch ( RuntimeException $e ) {
			$failed = 0 === strpos( $e->getMessage(), 'WP_CLI::error' );
		}
		check( $failed );
	}
}
