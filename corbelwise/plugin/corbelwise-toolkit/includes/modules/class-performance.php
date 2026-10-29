<?php
/**
 * Performance module: removes code WordPress adds to every page that most sites never use.
 *
 * @package Corbelwise\Toolkit
 */

namespace Corbelwise\Toolkit;

defined( 'ABSPATH' ) || exit;

/**
 * Performance settings.
 */
class Performance extends Module {

	/** {@inheritDoc} */
	public function id() {
		return 'performance';
	}

	/** {@inheritDoc} */
	public function label() {
		return __( 'Performance', 'corbelwise-toolkit' );
	}

	/** {@inheritDoc} */
	public function description() {
		return __( 'Lighter pages: removes the emoji script, unused header tags and other extras, and calms background requests.', 'corbelwise-toolkit' );
	}

	/** {@inheritDoc} */
	public function default_enabled() {
		return true;
	}

	/** {@inheritDoc} */
	public function fields() {
		return array(
			'disable_emojis'   => array(
				'type'    => 'checkbox',
				'label'   => __( 'Remove the emoji script and styles', 'corbelwise-toolkit' ),
				'help'    => __( 'Every current browser shows emoji on its own. Saves a script and a style on every page.', 'corbelwise-toolkit' ),
				'default' => true,
			),
			'clean_head'       => array(
				'type'    => 'checkbox',
				'label'   => __( 'Remove unused tags from the page header', 'corbelwise-toolkit' ),
				'help'    => __( 'Removes the RSD, Windows Live Writer, shortlink and previous/next post links. Feeds and REST API links stay.', 'corbelwise-toolkit' ),
				'default' => true,
			),
			'disable_embeds'   => array(
				'type'    => 'checkbox',
				'label'   => __( 'Stop other sites from embedding your posts as cards', 'corbelwise-toolkit' ),
				'help'    => __( 'Removes the embed discovery links and script. You can still embed YouTube and other services in your own pages.', 'corbelwise-toolkit' ),
				'default' => false,
			),
			'heartbeat'        => array(
				'type'    => 'select',
				'label'   => __( 'Background "heartbeat" requests', 'corbelwise-toolkit' ),
				'help'    => __( 'WordPress polls the server while you are logged in. Slowing it down reduces server load on busy sites.', 'corbelwise-toolkit' ),
				'options' => array(
					'default' => __( 'WordPress default', 'corbelwise-toolkit' ),
					'slow'    => __( 'Every 60 seconds', 'corbelwise-toolkit' ),
					'admin'   => __( 'Only in the admin area', 'corbelwise-toolkit' ),
				),
				'default' => 'admin',
			),
			'revisions'        => array(
				'type'    => 'number',
				'label'   => __( 'Revisions kept per post', 'corbelwise-toolkit' ),
				'help'    => __( '0 keeps WordPress\'s setting (unlimited unless wp-config.php says otherwise). A limit keeps the database small.', 'corbelwise-toolkit' ),
				'default' => 0,
				'min'     => 0,
				'max'     => 100,
			),
			'no_self_pings'    => array(
				'type'    => 'checkbox',
				'label'   => __( 'Do not ping your own site when you link to your own posts', 'corbelwise-toolkit' ),
				'default' => true,
			),
			'no_jquery_migrate' => array(
				'type'    => 'checkbox',
				'label'   => __( 'Do not load jQuery Migrate on the front end', 'corbelwise-toolkit' ),
				'help'    => __( 'Only needed by very old plugins. The Corbelwise theme uses no jQuery at all. Check your site after switching this on.', 'corbelwise-toolkit' ),
				'default' => false,
			),
		);
	}

	/** {@inheritDoc} */
	public function boot() {
		if ( $this->get( 'disable_emojis' ) ) {
			$this->remove_emojis();
		}
		if ( $this->get( 'clean_head' ) ) {
			remove_action( 'wp_head', 'rsd_link' );
			remove_action( 'wp_head', 'wlwmanifest_link' );
			remove_action( 'wp_head', 'wp_shortlink_wp_head' );
			remove_action( 'wp_head', 'adjacent_posts_rel_link_wp_head' );
			remove_action( 'template_redirect', 'wp_shortlink_header', 11 );
		}
		if ( $this->get( 'disable_embeds' ) ) {
			remove_action( 'wp_head', 'wp_oembed_add_discovery_links' );
			remove_action( 'wp_head', 'wp_oembed_add_host_js' );
			add_action(
				'wp_enqueue_scripts',
				static function () {
					wp_dequeue_script( 'wp-embed' );
				},
				100
			);
		}
		$heartbeat = $this->get( 'heartbeat' );
		if ( 'slow' === $heartbeat ) {
			add_filter( 'heartbeat_settings', array( $this, 'slow_heartbeat' ) );
		} elseif ( 'admin' === $heartbeat ) {
			add_action( 'wp_enqueue_scripts', array( $this, 'dequeue_heartbeat' ), 100 );
		}
		$revisions = (int) $this->get( 'revisions' );
		if ( $revisions > 0 ) {
			add_filter(
				'wp_revisions_to_keep',
				static function () use ( $revisions ) {
					return $revisions;
				}
			);
		}
		if ( $this->get( 'no_self_pings' ) ) {
			add_action( 'pre_ping', array( $this, 'drop_self_pings' ) );
		}
		if ( $this->get( 'no_jquery_migrate' ) ) {
			add_action( 'wp_default_scripts', array( $this, 'drop_jquery_migrate' ) );
		}
	}

	/**
	 * Remove WordPress's emoji detection script, styles and related hints.
	 */
	private function remove_emojis() {
		remove_action( 'wp_head', 'print_emoji_detection_script', 7 );
		remove_action( 'admin_print_scripts', 'print_emoji_detection_script' );
		remove_action( 'wp_print_styles', 'print_emoji_styles' );
		remove_action( 'admin_print_styles', 'print_emoji_styles' );
		remove_action( 'wp_enqueue_scripts', 'wp_enqueue_emoji_styles' );
		remove_action( 'admin_enqueue_scripts', 'wp_enqueue_emoji_styles' );
		remove_filter( 'the_content_feed', 'wp_staticize_emoji' );
		remove_filter( 'comment_text_rss', 'wp_staticize_emoji' );
		remove_filter( 'wp_mail', 'wp_staticize_emoji_for_email' );
		add_filter( 'emoji_svg_url', '__return_false' );
		add_filter(
			'wp_resource_hints',
			static function ( $urls, $relation ) {
				if ( 'dns-prefetch' === $relation ) {
					$urls = array_filter(
						$urls,
						static function ( $url ) {
							return false === strpos( is_array( $url ) ? (string) ( $url['href'] ?? '' ) : (string) $url, 's.w.org' );
						}
					);
				}
				return $urls;
			},
			10,
			2
		);
	}

	/**
	 * Poll every 60 seconds.
	 *
	 * @param array $settings Heartbeat settings.
	 * @return array
	 */
	public function slow_heartbeat( $settings ) {
		$settings['interval'] = 60;
		return $settings;
	}

	/**
	 * Keep the heartbeat script off public pages.
	 */
	public function dequeue_heartbeat() {
		wp_dequeue_script( 'heartbeat' );
	}

	/**
	 * Remove links to this site from the list of pings.
	 *
	 * @param string[] $links Links to ping (by reference).
	 */
	public function drop_self_pings( &$links ) {
		$home = home_url();
		foreach ( $links as $i => $link ) {
			if ( 0 === strpos( $link, $home ) ) {
				unset( $links[ $i ] );
			}
		}
	}

	/**
	 * Remove jquery-migrate from jQuery's dependencies on the front end.
	 *
	 * @param \WP_Scripts $scripts Scripts registry.
	 */
	public function drop_jquery_migrate( $scripts ) {
		if ( is_admin() || ! isset( $scripts->registered['jquery'] ) ) {
			return;
		}
		$scripts->registered['jquery']->deps = array_values( array_diff( $scripts->registered['jquery']->deps, array( 'jquery-migrate' ) ) );
	}
}
