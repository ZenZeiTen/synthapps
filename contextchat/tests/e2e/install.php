<?php
/**
 * Install WordPress, activate ContextChat and create demo content.
 *
 *   php tests/e2e/install.php <site-dir> <site-url>
 */

$site = rtrim( $argv[1], '/' );
$url  = rtrim( $argv[2], '/' );

define( 'WP_INSTALLING', true );
$parts                  = parse_url( $url );
$_SERVER['HTTP_HOST']   = $parts['host'] . ( isset( $parts['port'] ) ? ':' . $parts['port'] : '' );
$_SERVER['REQUEST_URI'] = '/';
require $site . '/wp-load.php';
require_once ABSPATH . 'wp-admin/includes/upgrade.php';
require_once ABSPATH . 'wp-admin/includes/plugin.php';

wp_install( 'Nusa Translate', 'admin', 'admin@example.com', true, '', 'password' );
update_option( 'siteurl', $url );
update_option( 'home', $url );
update_option( 'timezone_string', 'Asia/Jakarta' );
update_option( 'permalink_structure', '/%postname%/' );

foreach ( array( 'fake-woocommerce.php', 'contextchat/contextchat.php' ) as $plugin ) {
	$result = activate_plugin( $plugin );
	if ( is_wp_error( $result ) ) {
		fwrite( STDERR, $result->get_error_message() . "\n" );
		exit( 1 );
	}
}
// Activation hooks of the plugins above ran in this request, but their init hooks did not.
do_action( 'init' );

$visa = wp_insert_post(
	array(
		'post_type'    => 'page',
		'post_status'  => 'publish',
		'post_title'   => 'Sworn Translation for Visa',
		'post_name'    => 'visa-translation',
		'post_content' => '<!-- wp:paragraph --><p>Certified translations of passports, birth certificates and diplomas for visa applications.</p><!-- /wp:paragraph --><!-- wp:contextchat/button {"text":"Ask the visa desk"} /-->',
	)
);
$contact = wp_insert_post(
	array(
		'post_type'    => 'page',
		'post_status'  => 'publish',
		'post_title'   => 'Contact',
		'post_name'    => 'contact',
		'post_content' => '<!-- wp:paragraph --><p>Write to us any time.</p><!-- /wp:paragraph --><!-- wp:shortcode -->[contextchat text="Message Rina" agent="rina"]<!-- /wp:shortcode -->',
	)
);
$hidden = wp_insert_post(
	array(
		'post_type'    => 'page',
		'post_status'  => 'publish',
		'post_title'   => 'Checkout',
		'post_name'    => 'checkout',
		'post_content' => 'No chat button here.',
	)
);
update_post_meta( $hidden, '_contextchat_hide', true );

$custom = wp_insert_post(
	array(
		'post_type'    => 'page',
		'post_status'  => 'publish',
		'post_title'   => 'Interpreting',
		'post_name'    => 'interpreting',
		'post_content' => 'Simultaneous and consecutive interpreting.',
	)
);
update_post_meta( $custom, '_contextchat_message', 'Hello! I need an interpreter. I found you via {utm_source|your website}.' );

$product = wp_insert_post(
	array(
		'post_type'    => 'product',
		'post_status'  => 'publish',
		'post_title'   => 'Certified Translation – 1 page',
		'post_name'    => 'certified-translation',
		'post_content' => 'One page of sworn translation, delivered as PDF and hard copy.',
	)
);
update_post_meta( $product, '_price', '150000' );
update_post_meta( $product, '_sku', 'TR-001' );
wp_set_object_terms( $product, 'legal', 'product_cat' );

// The plugin was activated during this request, after its own init hooks would have run,
// so sanitise explicitly, exactly as the settings screen does.
update_option(
	'contextchat_settings',
	ContextChat_Settings::sanitize( array(
		'enabled'         => true,
		'country_code'    => '62',
		'phone'           => '0812 0000 0000',
		'mode'            => 'widget',
		'composer'        => true,
		'agents'          => array(
			array( 'id' => 'rina', 'name' => 'Rina Kartika', 'role' => 'Quotes & orders', 'phone' => '0812 1111 2222' ),
			array( 'id' => 'budi', 'name' => 'Budi Santoso', 'role' => 'Visa document desk', 'phone' => '+62 813 3333 4444', 'always' => '1' ),
		),
		'default_message' => 'Hi! I have a question about "{page_title}" ({page_url}).',
		'rules'           => array(
			array(
				'id'      => 'visa',
				'label'   => 'Visa pages',
				'type'    => 'url_contains',
				'value'   => '/visa',
				'message' => 'Hi {agent_name}! I need a sworn translation for a visa application. Page: {page_url}',
				'agents'  => array( 'budi' ),
			),
			array(
				'id'      => 'legal',
				'label'   => 'Legal products',
				'type'    => 'product_category',
				'value'   => 'legal',
				'message' => 'Hi! I\'d like to order {product_name} ({product_price}, SKU {product_sku}). {page_url}',
				'agents'  => array(),
			),
		),
		'label'           => 'Chat with us',
		'label_display'   => 'desktop',
		'position'        => 'right',
		'offset_x'        => 24,
		'offset_y'        => 24,
		'size'            => 60,
		'color'           => '#25d366',
		'icon_color'      => '#ffffff',
		'header_color'    => '#075e54',
		'pulse'           => '1',
		'show_on'         => 'all',
		'header_title'    => 'Nusa Translate',
		'header_subtitle' => 'Typically replies within 15 minutes',
		'greeting'        => 'Hi there! 👋 Tell us what you need translated and we will send you a quote.',
		'hours_enabled'   => '',
		'offline_behavior' => 'note',
		'offline_note'    => 'We are offline right now (Mon–Fri, 09:00–17:00 WIB). Send your message and we will reply on the next working day.',
		'desktop_target'  => 'web',
		'woo_button'      => '1',
		'woo_button_text' => 'Ask about this product',
		'woo_message'     => 'Hi! I\'m interested in {product_name} ({product_price}). {page_url}',
		'analytics'       => '1',
		'datalayer'       => '1',
		'retention_days'  => 180,
	) )
);

flush_rewrite_rules();

echo wp_json_encode(
	array(
		'visa'    => get_permalink( $visa ),
		'contact' => get_permalink( $contact ),
		'hidden'  => get_permalink( $hidden ),
		'custom'  => get_permalink( $custom ),
		'product' => get_permalink( $product ),
	),
	JSON_UNESCAPED_SLASHES
) . "\n";
