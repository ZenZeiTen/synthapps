<?php
/**
 * Front end: the floating button and panel, the [contextchat] shortcode and the block.
 *
 * Every button is a real link with a server-built message, so it works before the script
 * loads and without it. The script then adds what only the browser knows (campaign tags,
 * referrer, the visitor's clock), opening hours and click tracking.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Front end.
 */
class ContextChat_Frontend {

	/** Whether a button needing the script was printed on this page. @var bool */
	private static $needs_assets = false;

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue_for_float' ) );
		// Before wp_print_footer_scripts (priority 20), so the settings JSON precedes the script.
		add_action( 'wp_footer', array( __CLASS__, 'render_float' ), 5 );
		add_shortcode( 'contextchat', array( __CLASS__, 'shortcode' ) );
		add_action( 'init', array( __CLASS__, 'register_block' ) );
	}

	/**
	 * Register the script and style. They are enqueued only when a button is printed.
	 */
	public static function register_assets() {
		wp_register_style( 'contextchat', CONTEXTCHAT_URL . 'assets/css/contextchat.css', array(), CONTEXTCHAT_VERSION );
		wp_register_script(
			'contextchat',
			CONTEXTCHAT_URL . 'assets/js/contextchat.js',
			array(),
			CONTEXTCHAT_VERSION,
			array(
				'in_footer' => true,
				'strategy'  => 'defer',
			)
		);
	}

	/**
	 * Register assets, and enqueue them when the floating button will be shown.
	 */
	public static function enqueue_for_float() {
		self::register_assets();
		if ( self::should_display() ) {
			self::enqueue();
		}
	}

	/**
	 * Should the floating button appear on this page?
	 *
	 * @return bool
	 */
	public static function should_display() {
		$s    = ContextChat_Settings::get();
		$show = ! empty( $s['enabled'] ) && ! is_admin() && ! is_feed() && ! is_embed() && ContextChat_Context::agents();

		if ( $show && is_singular() && get_post_meta( get_queried_object_id(), '_contextchat_hide', true ) ) {
			$show = false;
		}
		if ( $show && '' !== $s['exclude_ids'] && is_singular() ) {
			$ids  = array_map( 'absint', explode( ',', $s['exclude_ids'] ) );
			$show = ! in_array( (int) get_queried_object_id(), $ids, true );
		}
		if ( $show && '' !== $s['exclude_paths'] ) {
			$path = isset( $_SERVER['REQUEST_URI'] ) ? strtolower( rawurldecode( wp_unslash( $_SERVER['REQUEST_URI'] ) ) ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized -- only compared.
			foreach ( explode( "\n", strtolower( $s['exclude_paths'] ) ) as $needle ) {
				$needle = trim( $needle );
				if ( '' !== $needle && false !== strpos( $path, $needle ) ) {
					$show = false;
					break;
				}
			}
		}

		/**
		 * Filter whether the floating button shows on this page.
		 *
		 * @param bool $show Show it.
		 */
		return (bool) apply_filters( 'contextchat_should_display', $show );
	}

	/**
	 * Print the floating button and panel.
	 */
	public static function render_float() {
		if ( ! self::should_display() ) {
			self::print_config_if_needed();
			return;
		}

		$s        = ContextChat_Settings::get();
		$resolved = ContextChat_Context::resolve( 'float' );
		$vars     = ContextChat_Context::vars();
		$agents   = $resolved['agents'];
		$first    = $agents[0];
		$message  = ContextChat_Template::render( $resolved['template'], array_merge( $vars, array( 'agent_name' => $first['name'] ) ) );
		$widget   = 'widget' === $s['mode'];
		$panel_id = 'ctxc-panel';

		$classes = array(
			'ctxc',
			'ctxc--' . $s['position'],
			'ctxc--show-' . $s['show_on'],
			'ctxc--label-' . $s['label_display'],
		);
		if ( $s['pulse'] ) {
			$classes[] = 'ctxc--pulse';
		}
		if ( $s['delay'] > 0 ) {
			$classes[] = 'ctxc--wait';
		}
		if ( '' === $s['label'] ) {
			$classes[] = 'ctxc--label-never';
		}

		$style = sprintf(
			'--ctxc-color:%1$s;--ctxc-icon:%2$s;--ctxc-header:%3$s;--ctxc-size:%4$dpx;--ctxc-x:%5$dpx;--ctxc-y:%6$dpx;',
			$s['color'],
			$s['icon_color'],
			$s['header_color'],
			$s['size'],
			$s['offset_x'],
			$s['offset_y']
		);

		self::$needs_assets = true;
		self::enqueue();
		self::print_config( $resolved, $vars );
		?>
		<div id="contextchat" class="<?php echo esc_attr( implode( ' ', $classes ) ); ?>" style="<?php echo esc_attr( $style ); ?>" data-ctxc-template="<?php echo esc_attr( $resolved['template'] ); ?>" data-ctxc-rule="<?php echo esc_attr( $resolved['rule'] ); ?>">
			<?php if ( $widget ) : ?>
				<div class="ctxc-panel" id="<?php echo esc_attr( $panel_id ); ?>" role="dialog" aria-modal="false" aria-labelledby="ctxc-title" hidden>
					<div class="ctxc-head">
						<div class="ctxc-head-text">
							<p class="ctxc-title" id="ctxc-title"><?php echo esc_html( $s['header_title'] ); ?></p>
							<?php if ( '' !== $s['header_subtitle'] ) : ?>
								<p class="ctxc-subtitle"><?php echo esc_html( $s['header_subtitle'] ); ?></p>
							<?php endif; ?>
						</div>
						<button type="button" class="ctxc-close" aria-label="<?php esc_attr_e( 'Close chat window', 'contextchat' ); ?>">
							<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>
						</button>
					</div>
					<div class="ctxc-body">
						<?php if ( '' !== $s['greeting'] ) : ?>
							<p class="ctxc-bubble"><?php echo nl2br( esc_html( $s['greeting'] ) ); ?></p>
						<?php endif; ?>
						<p class="ctxc-offline" hidden><?php echo nl2br( esc_html( $s['offline_note'] ) ); ?></p>
						<?php if ( $s['composer'] ) : ?>
							<label class="ctxc-composer-label" for="ctxc-composer"><?php esc_html_e( 'Your message', 'contextchat' ); ?></label>
							<textarea class="ctxc-composer" id="ctxc-composer" rows="3" maxlength="<?php echo esc_attr( ContextChat_Template::MAX_LENGTH ); ?>"><?php echo esc_textarea( $message ); ?></textarea>
						<?php endif; ?>
						<ul class="ctxc-agents" aria-label="<?php esc_attr_e( 'Choose who to chat with', 'contextchat' ); ?>">
							<?php foreach ( $agents as $agent ) : ?>
								<li><?php self::agent_link( $agent, $message ); ?></li>
							<?php endforeach; ?>
						</ul>
					</div>
				</div>
			<?php endif; ?>
			<a class="ctxc-launcher" href="<?php echo esc_url( ContextChat_Template::link( $first['phone'], $message ) ); ?>" target="_blank" rel="noopener noreferrer"
				data-ctxc-agent="<?php echo esc_attr( $first['id'] ); ?>"
				<?php if ( $widget ) : ?>
					aria-controls="<?php echo esc_attr( $panel_id ); ?>" aria-expanded="false"
				<?php endif; ?>
				aria-label="<?php echo esc_attr( '' !== $s['label'] ? $s['label'] : __( 'Chat with us on WhatsApp', 'contextchat' ) ); ?>">
				<span class="ctxc-launcher-icon"><?php echo self::icon(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
				<?php if ( '' !== $s['label'] ) : ?>
					<span class="ctxc-launcher-label" aria-hidden="true"><?php echo esc_html( $s['label'] ); ?></span>
				<?php endif; ?>
			</a>
		</div>
		<?php
	}

	/**
	 * Print one agent row.
	 *
	 * @param array  $agent   Agent.
	 * @param string $message Initial message.
	 */
	private static function agent_link( array $agent, $message ) {
		$name     = '' !== $agent['name'] ? $agent['name'] : __( 'Support', 'contextchat' );
		$words    = preg_split( '/\s+/u', trim( $name ) );
		$initials = mb_strtoupper( mb_substr( $words[0], 0, 1 ) . ( isset( $words[1] ) ? mb_substr( $words[1], 0, 1 ) : '' ) );
		?>
		<a class="ctxc-agent" href="<?php echo esc_url( ContextChat_Template::link( $agent['phone'], $message ) ); ?>" target="_blank" rel="noopener noreferrer" data-ctxc-agent="<?php echo esc_attr( $agent['id'] ); ?>">
			<span class="ctxc-avatar" aria-hidden="true">
				<?php if ( '' !== $agent['avatar'] ) : ?>
					<img src="<?php echo esc_url( $agent['avatar'] ); ?>" alt="" width="44" height="44" loading="lazy" decoding="async">
				<?php else : ?>
					<span class="ctxc-initials"><?php echo esc_html( $initials ); ?></span>
				<?php endif; ?>
				<span class="ctxc-dot"></span>
			</span>
			<span class="ctxc-agent-text">
				<span class="ctxc-agent-name"><?php echo esc_html( $name ); ?></span>
				<?php if ( '' !== $agent['role'] ) : ?>
					<span class="ctxc-agent-role"><?php echo esc_html( $agent['role'] ); ?></span>
				<?php endif; ?>
				<span class="ctxc-agent-status" hidden></span>
			</span>
			<svg class="ctxc-agent-go" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
		</a>
		<?php
	}

	/**
	 * [contextchat] shortcode: an inline button that uses the same context and routing.
	 *
	 * Attributes: text, agent (agent ID), message (template), source (internal), class.
	 *
	 * @param array|string $atts Attributes.
	 * @return string
	 */
	public static function shortcode( $atts ) {
		$s    = ContextChat_Settings::get();
		$atts = shortcode_atts(
			array(
				'text'    => __( 'Chat on WhatsApp', 'contextchat' ),
				'agent'   => '',
				'message' => '',
				'source'  => 'shortcode',
				'class'   => '',
			),
			$atts,
			'contextchat'
		);

		if ( empty( $s['enabled'] ) ) {
			return '';
		}

		$source   = in_array( $atts['source'], array( 'shortcode', 'product', 'block' ), true ) ? $atts['source'] : 'shortcode';
		$resolved = ContextChat_Context::resolve( $source );
		$agents   = $resolved['agents'];
		if ( '' !== $atts['agent'] ) {
			$id     = sanitize_key( $atts['agent'] );
			$picked = array_values(
				array_filter(
					ContextChat_Context::agents(),
					static function ( $a ) use ( $id ) {
						return $a['id'] === $id;
					}
				)
			);
			// An unknown agent ID falls back to normal routing rather than hiding the button.
			if ( $picked ) {
				$agents = $picked;
			}
		}
		if ( ! $agents ) {
			return '';
		}

		$template = '' !== trim( $atts['message'] ) ? sanitize_textarea_field( $atts['message'] ) : $resolved['template'];
		$vars     = ContextChat_Context::vars();
		$message  = ContextChat_Template::render( $template, array_merge( $vars, array( 'agent_name' => $agents[0]['name'] ) ) );
		$classes  = trim( 'ctxc-inline ' . implode( ' ', array_map( 'sanitize_html_class', preg_split( '/\s+/', $atts['class'] ) ) ) );

		self::$needs_assets = true;
		self::enqueue();

		// Rendered inside the footer after the settings were printed (e.g. a footer widget):
		// print them now, next to the button.
		$config = '';
		if ( did_action( 'wp_footer' ) && ! did_action( 'contextchat_config_printed' ) ) {
			ob_start();
			self::print_config_if_needed();
			$config = ob_get_clean();
		}

		return $config . sprintf(
			'<a class="%1$s" href="%2$s" target="_blank" rel="noopener noreferrer" style="%3$s" data-ctxc-inline data-ctxc-template="%4$s" data-ctxc-agents="%5$s" data-ctxc-source="%6$s" data-ctxc-rule="%7$s">%8$s<span>%9$s</span></a>',
			esc_attr( $classes ),
			esc_url( ContextChat_Template::link( $agents[0]['phone'], $message ) ),
			esc_attr( '--ctxc-color:' . $s['color'] . ';--ctxc-icon:' . $s['icon_color'] . ';' ),
			esc_attr( $template ),
			esc_attr( implode( ',', wp_list_pluck( $agents, 'id' ) ) ),
			esc_attr( $source ),
			esc_attr( $resolved['rule'] ),
			self::icon( 20 ),
			esc_html( $atts['text'] )
		);
	}

	/**
	 * Dynamic block that renders the shortcode.
	 */
	public static function register_block() {
		if ( ! function_exists( 'register_block_type' ) ) {
			return;
		}
		wp_register_script(
			'contextchat-block',
			CONTEXTCHAT_URL . 'assets/js/block.js',
			array( 'wp-blocks', 'wp-element', 'wp-block-editor', 'wp-components', 'wp-i18n' ),
			CONTEXTCHAT_VERSION,
			true
		);
		wp_register_style( 'contextchat-editor', CONTEXTCHAT_URL . 'assets/css/contextchat.css', array(), CONTEXTCHAT_VERSION );
		wp_localize_script(
			'contextchat-block',
			'contextchatBlock',
			array(
				'agents' => array_map(
					static function ( $a ) {
						return array(
							'value' => $a['id'],
							'label' => '' !== $a['name'] ? $a['name'] : $a['phone'],
						);
					},
					ContextChat_Settings::get()['agents']
				),
			)
		);

		register_block_type(
			'contextchat/button',
			array(
				'api_version'     => 2,
				'editor_script'   => 'contextchat-block',
				'editor_style'    => 'contextchat-editor',
				'attributes'      => array(
					'text'    => array(
						'type'    => 'string',
						'default' => __( 'Chat on WhatsApp', 'contextchat' ),
					),
					'agent'   => array(
						'type'    => 'string',
						'default' => '',
					),
					'message' => array(
						'type'    => 'string',
						'default' => '',
					),
				),
				'render_callback' => static function ( $attrs ) {
					$html = self::shortcode(
						array(
							'text'    => isset( $attrs['text'] ) ? $attrs['text'] : '',
							'agent'   => isset( $attrs['agent'] ) ? $attrs['agent'] : '',
							'message' => isset( $attrs['message'] ) ? $attrs['message'] : '',
							'source'  => 'block',
						)
					);
					return '' === $html ? '' : '<div class="wp-block-contextchat-button">' . $html . '</div>';
				},
			)
		);
	}

	/**
	 * Enqueue the script and style.
	 */
	private static function enqueue() {
		if ( ! wp_script_is( 'contextchat', 'registered' ) ) {
			self::register_assets();
		}
		wp_enqueue_style( 'contextchat' );
		wp_enqueue_script( 'contextchat' );
	}

	/**
	 * Print the shared settings for inline buttons when no floating button printed them.
	 */
	public static function print_config_if_needed() {
		static $done = false;
		if ( $done || ! self::$needs_assets || did_action( 'contextchat_config_printed' ) ) {
			return;
		}
		$done = true;
		self::print_config( ContextChat_Context::resolve( 'shortcode' ), ContextChat_Context::vars() );
	}

	/**
	 * Print the settings the script needs as JSON.
	 *
	 * @param array $resolved Output of ContextChat_Context::resolve().
	 * @param array $vars     Server placeholder values.
	 */
	private static function print_config( array $resolved, array $vars ) {
		if ( did_action( 'contextchat_config_printed' ) ) {
			return;
		}
		$s   = ContextChat_Settings::get();
		$tz  = wp_timezone();
		$cfg = array(
			'rest'      => esc_url_raw( rest_url( 'contextchat/v1/click' ) ),
			'post'      => is_singular() ? (int) get_queried_object_id() : 0,
			'mode'      => $s['mode'],
			'target'    => $s['desktop_target'],
			'vars'      => $vars,
			'rule'      => $resolved['rule'],
			'agents'    => array_map(
				static function ( $a ) {
					return array(
						'id'     => $a['id'],
						'name'   => $a['name'],
						'phone'  => $a['phone'],
						'always' => ! empty( $a['always'] ),
					);
				},
				ContextChat_Context::agents()
			),
			'hours'     => array(
				'enabled' => ! empty( $s['hours_enabled'] ),
				'days'    => $s['hours'],
				'tz'      => preg_match( '#^[A-Za-z_]+/[A-Za-z_/+-]+$#', $tz->getName() ) ? $tz->getName() : '',
				'offset'  => (int) ( $tz->getOffset( new DateTime( 'now', $tz ) ) / 60 ),
			),
			'offline'   => array(
				'behavior' => $s['offline_behavior'],
				'suffix'   => $s['offline_suffix'],
			),
			'delay'     => (int) $s['delay'],
			'analytics' => ! empty( $s['analytics'] ),
			'datalayer' => ! empty( $s['datalayer'] ),
			'i18n'      => array(
				'online'  => __( 'Online', 'contextchat' ),
				'offline' => __( 'Offline – replies when we are back', 'contextchat' ),
			),
		);
		echo '<script type="application/json" id="contextchat-config">' . wp_json_encode( $cfg, JSON_HEX_TAG | JSON_HEX_AMP | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE ) . '</script>' . "\n";
		do_action( 'contextchat_config_printed' );
	}

	/**
	 * Chat icon. Drawn for this plugin rather than copied from a brand asset.
	 *
	 * @param int $size Pixel size.
	 * @return string
	 */
	public static function icon( $size = 28 ) {
		$size = (int) $size;
		return '<svg class="ctxc-icon" viewBox="0 0 32 32" width="' . $size . '" height="' . $size . '" aria-hidden="true" focusable="false">'
			. '<path d="M16 3.5C9.1 3.5 3.5 9 3.5 15.8c0 2.3.6 4.5 1.8 6.4L3.6 28.4l6.4-1.7c1.8 1 3.9 1.5 6 1.5 6.9 0 12.5-5.5 12.5-12.3S22.9 3.5 16 3.5z" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round"/>'
			. '<path d="M11.9 9.6c.4 0 .7.1.9.6l1.1 2.6c.1.3.1.6-.1.9l-.8 1c-.2.2-.2.5 0 .8.6 1 1.4 1.9 2.3 2.6.9.6 1.4.8 1.8.9.3.1.5 0 .7-.2l1-1.2c.2-.3.6-.4.9-.2l2.5 1.2c.4.2.6.4.6.7 0 .9-.4 2-1.4 2.5-1 .6-2.4.8-4.6-.1-2.6-1-4.6-3.2-5.8-5.2-.9-1.6-1.1-3-.6-4.1.4-.9 1.2-1.6 1.7-1.8z" fill="currentColor"/>'
			. '</svg>';
	}
}
