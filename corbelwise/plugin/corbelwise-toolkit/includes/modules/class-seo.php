<?php
/**
 * SEO module: page descriptions, social sharing tags, structured data and sensible indexing.
 *
 * Steps aside automatically when a dedicated SEO plugin is active, so tags are never printed twice.
 *
 * @package Corbelwise\Toolkit
 */

namespace Corbelwise\Toolkit;

defined( 'ABSPATH' ) || exit;

/**
 * SEO output.
 */
class Seo extends Module {

	const META_KEY = '_cwtk_description';

	/** {@inheritDoc} */
	public function id() {
		return 'seo';
	}

	/** {@inheritDoc} */
	public function label() {
		return __( 'SEO and sharing', 'corbelwise-toolkit' );
	}

	/** {@inheritDoc} */
	public function description() {
		return __( 'Search and sharing essentials: a description for every page, preview cards for social networks and messaging apps, and structured data that tells search engines who you are.', 'corbelwise-toolkit' );
	}

	/** {@inheritDoc} */
	public function default_enabled() {
		return true;
	}

	/** {@inheritDoc} */
	public function fields() {
		return array(
			'social_tags'   => array( 'type' => 'checkbox', 'label' => __( 'Add preview cards for social networks and messaging apps (Open Graph and X)', 'corbelwise-toolkit' ), 'default' => true ),
			'schema'        => array( 'type' => 'checkbox', 'label' => __( 'Add structured data: your business, the site, articles and breadcrumbs', 'corbelwise-toolkit' ), 'default' => true ),
			'share_image'   => array( 'type' => 'url', 'label' => __( 'Default share image', 'corbelwise-toolkit' ), 'help' => __( 'Used when a page has no featured image. 1200 × 630 pixels works everywhere.', 'corbelwise-toolkit' ), 'default' => '' ),
			'x_handle'      => array( 'type' => 'text', 'label' => __( 'X (Twitter) username', 'corbelwise-toolkit' ), 'placeholder' => '@yourbusiness', 'default' => '', 'maxlength' => 30 ),
			'noindex_thin'  => array( 'type' => 'checkbox', 'label' => __( 'Keep search results and empty pages out of search engines', 'corbelwise-toolkit' ), 'help' => __( 'Adds "noindex" to your site\'s search results and "page not found" pages.', 'corbelwise-toolkit' ), 'default' => true ),
		);
	}

	/**
	 * Name of an active SEO plugin, if any.
	 *
	 * @return string
	 */
	public static function competing_plugin() {
		$known = array(
			'WPSEO_VERSION'              => 'Yoast SEO',
			'RANK_MATH_VERSION'          => 'Rank Math',
			'AIOSEO_VERSION'             => 'All in One SEO',
			'SEOPRESS_VERSION'           => 'SEOPress',
			'THE_SEO_FRAMEWORK_VERSION'  => 'The SEO Framework',
			'SLIM_SEO_VER'               => 'Slim SEO',
		);
		foreach ( $known as $constant => $name ) {
			if ( defined( $constant ) ) {
				return $name;
			}
		}
		/**
		 * Filters the name of an active SEO plugin. Return a non-empty name to make this module step aside.
		 *
		 * @param string $name Detected plugin name, or an empty string.
		 */
		return (string) apply_filters( 'cwtk_seo_competing_plugin', '' );
	}

	/** {@inheritDoc} */
	public function paused_reason() {
		$other = self::competing_plugin();
		/* translators: %s: plugin name. */
		return $other ? sprintf( __( '%s is active, so this module adds nothing to your pages to avoid duplicate tags. The page descriptions you wrote are kept.', 'corbelwise-toolkit' ), $other ) : '';
	}

	/** {@inheritDoc} */
	public function boot() {
		// Late, so post types that other plugins register on init are included.
		add_action( 'init', array( $this, 'register_meta' ), 99 );
		add_action( 'enqueue_block_editor_assets', array( $this, 'editor_assets' ) );
		if ( self::competing_plugin() ) {
			return;
		}
		add_action( 'wp_head', array( $this, 'print_meta' ), 1 );
		if ( $this->get( 'schema' ) ) {
			add_action( 'wp_head', array( $this, 'print_schema' ), 20 );
		}
		if ( $this->get( 'noindex_thin' ) ) {
			add_filter( 'wp_robots', array( $this, 'robots' ) );
		}
	}

	/**
	 * Store the description on every public post type that has an editor.
	 */
	public function register_meta() {
		foreach ( get_post_types( array( 'public' => true, 'show_in_rest' => true ) ) as $type ) {
			if ( 'attachment' === $type ) {
				continue;
			}
			register_post_meta(
				$type,
				self::META_KEY,
				array(
					'type'              => 'string',
					'single'            => true,
					'show_in_rest'      => true,
					'default'           => '',
					'sanitize_callback' => static function ( $value ) {
						return Settings::cut( sanitize_textarea_field( (string) $value ), 320 );
					},
					'auth_callback'     => static function ( $allowed, $meta_key, $post_id ) {
						return current_user_can( 'edit_post', (int) $post_id );
					},
				)
			);
		}
	}

	/**
	 * The "Search description" panel in the post editor.
	 */
	public function editor_assets() {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( ! $screen || 'post' !== $screen->base ) {
			return;
		}
		wp_enqueue_script( 'cwtk-seo-panel', CWTK_URL . 'assets/seo-panel.js', array( 'wp-plugins', 'wp-edit-post', 'wp-element', 'wp-components', 'wp-data', 'wp-core-data', 'wp-i18n' ), CWTK_VERSION, true );
		wp_set_script_translations( 'cwtk-seo-panel', 'corbelwise-toolkit', CWTK_DIR . 'languages' );
	}

	/**
	 * The description for the current page.
	 *
	 * @return string
	 */
	public function current_description() {
		$text = '';
		$post = is_singular() ? get_queried_object() : null;
		if ( $post instanceof \WP_Post ) {
			$text = (string) get_post_meta( $post->ID, self::META_KEY, true );
		}
		if ( '' === $text && ( is_front_page() || is_home() ) ) {
			$business = Plugin::instance()->is_active( 'business' ) ? Plugin::instance()->module( 'business' ) : null;
			$text     = $business ? (string) $business->get( 'summary' ) : '';
			$text     = '' !== $text ? $text : get_bloginfo( 'description' );
		} elseif ( '' === $text && $post instanceof \WP_Post ) {
			if ( ! post_password_required( $post ) ) {
				$text = has_excerpt( $post ) ? $post->post_excerpt : wp_trim_words( excerpt_remove_blocks( strip_shortcodes( $post->post_content ) ), 30, '…' );
			}
		} elseif ( '' === $text && ( is_category() || is_tag() || is_tax() ) ) {
			$text = term_description();
		} elseif ( '' === $text && is_author() ) {
			$text = get_the_author_meta( 'description', (int) get_queried_object_id() );
		}
		$text = trim( preg_replace( '/\s+/', ' ', wp_strip_all_tags( (string) $text ) ) );
		return Settings::cut( $text, 300 );
	}

	/**
	 * The image to show when the page is shared.
	 *
	 * @return array{url:string,width:int,height:int}|null
	 */
	private function share_image() {
		if ( is_singular() && has_post_thumbnail() ) {
			$image = wp_get_attachment_image_src( get_post_thumbnail_id(), 'large' );
			if ( $image ) {
				return array(
					'url'    => $image[0],
					'width'  => (int) $image[1],
					'height' => (int) $image[2],
				);
			}
		}
		$url = (string) $this->get( 'share_image' );
		return $url ? array(
			'url'    => $url,
			'width'  => 0,
			'height' => 0,
		) : null;
	}

	/**
	 * The canonical address of the current page.
	 *
	 * @return string
	 */
	private function current_url() {
		if ( is_singular() ) {
			$url = wp_get_canonical_url();
			return $url ? $url : (string) get_permalink();
		}
		if ( is_front_page() ) {
			return home_url( '/' );
		}
		if ( is_category() || is_tag() || is_tax() ) {
			$link = get_term_link( get_queried_object() );
			return is_wp_error( $link ) ? '' : $link;
		}
		if ( is_home() ) {
			return (string) get_permalink( (int) get_option( 'page_for_posts' ) );
		}
		return '';
	}

	/**
	 * Print the description and the sharing tags.
	 */
	public function print_meta() {
		if ( is_404() ) {
			return;
		}
		$description = $this->current_description();
		if ( '' !== $description ) {
			printf( '<meta name="description" content="%s">' . "\n", esc_attr( $description ) );
		}
		if ( ! $this->get( 'social_tags' ) ) {
			return;
		}
		$title = wp_get_document_title();
		$url   = $this->current_url();
		$image = $this->share_image();
		$tags  = array(
			'og:type'        => is_singular( 'post' ) ? 'article' : 'website',
			'og:site_name'   => get_bloginfo( 'name' ),
			'og:title'       => $title,
			'og:description' => $description,
			'og:url'         => $url,
			'og:locale'      => str_replace( '-', '_', get_bloginfo( 'language' ) ),
		);
		if ( $image ) {
			$tags['og:image'] = $image['url'];
			if ( $image['width'] ) {
				$tags['og:image:width']  = (string) $image['width'];
				$tags['og:image:height'] = (string) $image['height'];
			}
		}
		if ( is_singular( 'post' ) ) {
			$tags['article:published_time'] = (string) get_the_date( 'c' );
			$tags['article:modified_time']  = (string) get_the_modified_date( 'c' );
		}
		foreach ( $tags as $property => $content ) {
			if ( '' !== (string) $content ) {
				printf( '<meta property="%s" content="%s">' . "\n", esc_attr( $property ), esc_attr( $content ) );
			}
		}
		$twitter = array(
			'twitter:card' => $image ? 'summary_large_image' : 'summary',
			'twitter:site' => ltrim( (string) $this->get( 'x_handle' ), '@' ) ? '@' . ltrim( (string) $this->get( 'x_handle' ), '@' ) : '',
		);
		foreach ( $twitter as $name => $content ) {
			if ( '' !== $content ) {
				printf( '<meta name="%s" content="%s">' . "\n", esc_attr( $name ), esc_attr( $content ) );
			}
		}
	}

	/**
	 * Build the structured data graph for the current page.
	 *
	 * @return array
	 */
	public function graph() {
		$plugin   = Plugin::instance();
		$business = $plugin->is_active( 'business' ) ? $plugin->module( 'business' ) : null;
		$org      = $business ? $business->schema() : array(
			'@type' => 'Organization',
			'@id'   => home_url( '/#organization' ),
			'name'  => get_bloginfo( 'name' ),
			'url'   => home_url( '/' ),
		);
		$logo_id  = (int) get_theme_mod( 'custom_logo' );
		$logo_id  = $logo_id ? $logo_id : (int) get_option( 'site_logo' );
		if ( $logo_id && wp_get_attachment_image_url( $logo_id, 'full' ) ) {
			$org['logo'] = wp_get_attachment_image_url( $logo_id, 'full' );
		} elseif ( has_site_icon() ) {
			$org['logo'] = get_site_icon_url( 512 );
		}

		$graph = array(
			$org,
			array(
				'@type'           => 'WebSite',
				'@id'             => home_url( '/#website' ),
				'url'             => home_url( '/' ),
				'name'            => get_bloginfo( 'name' ),
				'publisher'       => array( '@id' => home_url( '/#organization' ) ),
				'inLanguage'      => get_bloginfo( 'language' ),
				'potentialAction' => array(
					'@type'       => 'SearchAction',
					'target'      => home_url( '/?s={search_term_string}' ),
					'query-input' => 'required name=search_term_string',
				),
			),
		);

		if ( is_singular() ) {
			$post   = get_queried_object();
			$url    = $this->current_url();
			$page   = array(
				'@type'      => 'WebPage',
				'@id'        => $url . '#webpage',
				'url'        => $url,
				'name'       => wp_get_document_title(),
				'isPartOf'   => array( '@id' => home_url( '/#website' ) ),
				'inLanguage' => get_bloginfo( 'language' ),
			);
			$crumbs = $this->breadcrumbs( $post );
			if ( count( $crumbs ) > 1 ) {
				$items = array();
				foreach ( $crumbs as $i => $crumb ) {
					$items[] = array(
						'@type'    => 'ListItem',
						'position' => $i + 1,
						'name'     => $crumb[0],
						'item'     => $crumb[1],
					);
				}
				$graph[]              = array(
					'@type'           => 'BreadcrumbList',
					'@id'             => $url . '#breadcrumb',
					'itemListElement' => $items,
				);
				$page['breadcrumb'] = array( '@id' => $url . '#breadcrumb' );
			}
			$graph[] = $page;

			if ( $post instanceof \WP_Post && 'post' === $post->post_type ) {
				$article = array(
					'@type'            => 'BlogPosting',
					'@id'              => $url . '#article',
					'headline'         => wp_strip_all_tags( get_the_title( $post ) ),
					'datePublished'    => get_the_date( 'c', $post ),
					'dateModified'     => get_the_modified_date( 'c', $post ),
					'mainEntityOfPage' => array( '@id' => $url . '#webpage' ),
					'publisher'        => array( '@id' => home_url( '/#organization' ) ),
					'author'           => array(
						'@type' => 'Person',
						'name'  => get_the_author_meta( 'display_name', (int) $post->post_author ),
					),
				);
				$image   = $this->share_image();
				if ( $image ) {
					$article['image'] = $image['url'];
				}
				$description = $this->current_description();
				if ( '' !== $description ) {
					$article['description'] = $description;
				}
				$graph[] = $article;
			}
		}

		/**
		 * Filters the structured data graph before it is printed.
		 *
		 * @param array $graph Graph nodes.
		 */
		return (array) apply_filters( 'cwtk_schema_graph', $graph );
	}

	/**
	 * Breadcrumb trail for a post or page: home, parents or category, then the item.
	 *
	 * @param mixed $post Queried object.
	 * @return array<int, array{0:string,1:string}> Name and URL pairs.
	 */
	private function breadcrumbs( $post ) {
		if ( ! $post instanceof \WP_Post || (int) get_option( 'page_on_front' ) === $post->ID ) {
			return array();
		}
		$trail = array( array( __( 'Home', 'corbelwise-toolkit' ), home_url( '/' ) ) );
		if ( is_post_type_hierarchical( $post->post_type ) ) {
			foreach ( array_reverse( get_post_ancestors( $post ) ) as $ancestor ) {
				$trail[] = array( wp_strip_all_tags( get_the_title( $ancestor ) ), (string) get_permalink( $ancestor ) );
			}
		} elseif ( 'post' === $post->post_type ) {
			$categories = get_the_category( $post->ID );
			if ( $categories ) {
				$link = get_category_link( $categories[0] );
				if ( $link ) {
					$trail[] = array( $categories[0]->name, $link );
				}
			}
		}
		$trail[] = array( wp_strip_all_tags( get_the_title( $post ) ), (string) get_permalink( $post ) );
		return $trail;
	}

	/**
	 * Print the structured data.
	 */
	public function print_schema() {
		if ( is_404() || is_search() ) {
			return;
		}
		$data = array(
			'@context' => 'https://schema.org',
			'@graph'   => array_values( $this->graph() ),
		);
		echo '<script type="application/ld+json">' . wp_json_encode( $data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP ) . "</script>\n";
	}

	/**
	 * Keep search results and 404 pages out of search engines.
	 *
	 * @param array $robots Robots directives.
	 * @return array
	 */
	public function robots( $robots ) {
		if ( is_search() || is_404() ) {
			$robots['noindex'] = true;
			$robots['follow']  = true;
		}
		return $robots;
	}
}
