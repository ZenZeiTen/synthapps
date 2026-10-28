<?php
/**
 * Admin: the settings screen and the analytics report.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Admin screens.
 */
class ContextChat_Admin {

	const SLUG     = 'contextchat';
	const CAP      = 'manage_options';
	const RANGES   = array( 7, 30, 90 );

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ) );
		add_action( 'admin_notices', array( __CLASS__, 'setup_notice' ) );
		add_action( 'admin_post_contextchat_export', array( __CLASS__, 'export' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( CONTEXTCHAT_FILE ), array( __CLASS__, 'action_links' ) );
	}

	/**
	 * Menu entries.
	 */
	public static function menu() {
		add_menu_page( __( 'ContextChat', 'contextchat' ), __( 'ContextChat', 'contextchat' ), self::CAP, self::SLUG, array( __CLASS__, 'settings_page' ), 'dashicons-format-chat', 81 );
		add_submenu_page( self::SLUG, __( 'ContextChat Settings', 'contextchat' ), __( 'Settings', 'contextchat' ), self::CAP, self::SLUG, array( __CLASS__, 'settings_page' ) );
		add_submenu_page( self::SLUG, __( 'ContextChat Analytics', 'contextchat' ), __( 'Analytics', 'contextchat' ), self::CAP, self::SLUG . '-analytics', array( __CLASS__, 'analytics_page' ) );
	}

	/**
	 * Admin assets, only on our screens.
	 *
	 * @param string $hook Screen hook.
	 */
	public static function assets( $hook ) {
		if ( false === strpos( $hook, self::SLUG ) ) {
			return;
		}
		wp_enqueue_media();
		wp_enqueue_style( 'contextchat', CONTEXTCHAT_URL . 'assets/css/contextchat.css', array(), CONTEXTCHAT_VERSION );
		wp_enqueue_style( 'contextchat-admin', CONTEXTCHAT_URL . 'assets/css/admin.css', array(), CONTEXTCHAT_VERSION );
		wp_enqueue_script( 'contextchat-engine', CONTEXTCHAT_URL . 'assets/js/contextchat.js', array(), CONTEXTCHAT_VERSION, true );
		wp_enqueue_script( 'contextchat-admin', CONTEXTCHAT_URL . 'assets/js/admin.js', array( 'contextchat-engine', 'jquery-ui-sortable' ), CONTEXTCHAT_VERSION, true );

		$samples = array();
		foreach ( ContextChat_Template::placeholders() as $key => $p ) {
			$samples[ $key ] = $p['sample'];
		}
		$samples['site_name'] = ContextChat_Context::plain( get_bloginfo( 'name' ) );
		wp_localize_script(
			'contextchat-admin',
			'contextchatAdmin',
			array(
				'samples' => $samples,
				'i18n'    => array(
					'chooseAvatar' => __( 'Choose avatar', 'contextchat' ),
					'useImage'     => __( 'Use this image', 'contextchat' ),
					'confirmRemove' => __( 'Remove this row?', 'contextchat' ),
				),
			)
		);
	}

	/**
	 * Nudge to finish setup when there is no number to chat with.
	 */
	public static function setup_notice() {
		$screen = get_current_screen();
		if ( ! current_user_can( self::CAP ) || ( $screen && false !== strpos( $screen->id, self::SLUG ) ) ) {
			return;
		}
		if ( ContextChat_Context::agents() ) {
			return;
		}
		printf(
			'<div class="notice notice-info"><p>%1$s <a href="%2$s">%3$s</a></p></div>',
			esc_html__( 'ContextChat is active but has no WhatsApp number yet, so no button is shown.', 'contextchat' ),
			esc_url( admin_url( 'admin.php?page=' . self::SLUG ) ),
			esc_html__( 'Add a number', 'contextchat' )
		);
	}

	/**
	 * "Settings" link on the Plugins screen.
	 *
	 * @param array $links Links.
	 * @return array
	 */
	public static function action_links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( admin_url( 'admin.php?page=' . self::SLUG ) ) . '">' . esc_html__( 'Settings', 'contextchat' ) . '</a>' );
		return $links;
	}

	/**
	 * Settings screen.
	 */
	public static function settings_page() {
		if ( ! current_user_can( self::CAP ) ) {
			return;
		}
		$s    = ContextChat_Settings::get();
		$tabs = array(
			'general'    => __( 'General', 'contextchat' ),
			'routing'    => __( 'Agents & context', 'contextchat' ),
			'appearance' => __( 'Appearance', 'contextchat' ),
			'hours'      => __( 'Opening hours', 'contextchat' ),
			'advanced'   => __( 'WooCommerce & advanced', 'contextchat' ),
		);
		?>
		<div class="wrap ctxc-admin">
			<h1><?php esc_html_e( 'ContextChat', 'contextchat' ); ?></h1>
			<p class="ctxc-lede"><?php esc_html_e( 'A chat button that tells you what the visitor was looking at before they wrote to you.', 'contextchat' ); ?></p>
			<?php settings_errors(); ?>

			<nav class="nav-tab-wrapper ctxc-tabs" role="tablist">
				<?php foreach ( $tabs as $id => $label ) : ?>
					<a href="#ctxc-tab-<?php echo esc_attr( $id ); ?>" class="nav-tab" role="tab" data-tab="<?php echo esc_attr( $id ); ?>"><?php echo esc_html( $label ); ?></a>
				<?php endforeach; ?>
			</nav>

			<form method="post" action="options.php" class="ctxc-form">
				<?php settings_fields( 'contextchat' ); ?>

				<section id="ctxc-tab-general" class="ctxc-tab" data-tab="general">
					<h2><?php esc_html_e( 'General', 'contextchat' ); ?></h2>
					<table class="form-table" role="presentation">
						<?php
						self::row_checkbox( 'enabled', __( 'Show the chat button', 'contextchat' ), __( 'Turn the floating button on across the site.', 'contextchat' ) );
						self::row_text( 'phone', __( 'Main WhatsApp number', 'contextchat' ), __( 'Used when no agents are set up. Include the country code, e.g. +62 812 3456 7890.', 'contextchat' ), 'tel' );
						self::row_text( 'country_code', __( 'Default country code', 'contextchat' ), __( 'Optional. Lets you type local numbers such as 0812… (for Indonesia enter 62).', 'contextchat' ), 'text', 'small-text' );
						self::row_select(
							'mode',
							__( 'Button opens', 'contextchat' ),
							array(
								'widget' => __( 'A chat panel with agents and an editable message', 'contextchat' ),
								'direct' => __( 'WhatsApp straight away', 'contextchat' ),
							)
						);
						self::row_checkbox( 'composer', __( 'Show the message in the panel', 'contextchat' ), __( 'Visitors see the pre-filled message and can edit it before sending. Recommended: people trust what they can read.', 'contextchat' ) );
						?>
					</table>

					<h2><?php esc_html_e( 'Default message', 'contextchat' ); ?></h2>
					<p><?php esc_html_e( 'Sent when no rule below matches the page. Click a placeholder to insert it.', 'contextchat' ); ?></p>
					<?php self::template_field( 'default_message', $s['default_message'] ); ?>
				</section>

				<section id="ctxc-tab-routing" class="ctxc-tab" data-tab="routing">
					<h2><?php esc_html_e( 'Agents', 'contextchat' ); ?></h2>
					<p><?php esc_html_e( 'People or teams visitors can choose between. Leave empty to use the main number only.', 'contextchat' ); ?></p>
					<div class="ctxc-repeater" data-repeater="agents">
						<div class="ctxc-rows">
							<?php
							foreach ( $s['agents'] as $i => $agent ) {
								self::agent_row( (string) $i, $agent );
							}
							?>
						</div>
						<template><?php self::agent_row( '__i__', array() ); ?></template>
						<button type="button" class="button ctxc-add"><?php esc_html_e( 'Add agent', 'contextchat' ); ?></button>
					</div>

					<h2><?php esc_html_e( 'Context rules', 'contextchat' ); ?></h2>
					<p><?php esc_html_e( 'Give different pages their own message and agents. The first matching rule wins; drag rows to change the order. A message set on an individual page in the editor beats every rule.', 'contextchat' ); ?></p>
					<div class="ctxc-repeater" data-repeater="rules">
						<div class="ctxc-rows">
							<?php
							foreach ( $s['rules'] as $i => $rule ) {
								self::rule_row( (string) $i, $rule, $s['agents'] );
							}
							?>
						</div>
						<template><?php self::rule_row( '__i__', array(), $s['agents'] ); ?></template>
						<button type="button" class="button ctxc-add"><?php esc_html_e( 'Add rule', 'contextchat' ); ?></button>
					</div>
				</section>

				<section id="ctxc-tab-appearance" class="ctxc-tab" data-tab="appearance">
					<h2><?php esc_html_e( 'Button', 'contextchat' ); ?></h2>
					<div class="ctxc-split">
						<table class="form-table" role="presentation">
							<?php
							self::row_text( 'label', __( 'Button text', 'contextchat' ), __( 'Leave empty for an icon-only button.', 'contextchat' ) );
							self::row_select(
								'label_display',
								__( 'Show text', 'contextchat' ),
								array(
									'desktop' => __( 'On larger screens only', 'contextchat' ),
									'always'  => __( 'Always', 'contextchat' ),
									'never'   => __( 'Never (icon only)', 'contextchat' ),
								)
							);
							self::row_select(
								'position',
								__( 'Position', 'contextchat' ),
								array(
									'right' => __( 'Bottom right', 'contextchat' ),
									'left'  => __( 'Bottom left', 'contextchat' ),
								)
							);
							self::row_number( 'offset_x', __( 'Distance from side (px)', 'contextchat' ), 0, 200 );
							self::row_number( 'offset_y', __( 'Distance from bottom (px)', 'contextchat' ), 0, 300 );
							self::row_number( 'size', __( 'Button size (px)', 'contextchat' ), 40, 96 );
							self::row_text( 'color', __( 'Button colour', 'contextchat' ), '', 'color' );
							self::row_text( 'icon_color', __( 'Icon and text colour', 'contextchat' ), '', 'color' );
							self::row_text( 'header_color', __( 'Panel header colour', 'contextchat' ), '', 'color' );
							self::row_checkbox( 'pulse', __( 'Gentle pulse', 'contextchat' ), __( 'Draws the eye once. Turned off automatically for visitors who prefer reduced motion.', 'contextchat' ) );
							self::row_number( 'delay', __( 'Appear after (seconds)', 'contextchat' ), 0, 120 );
							self::row_select(
								'show_on',
								__( 'Show on', 'contextchat' ),
								array(
									'all'     => __( 'All devices', 'contextchat' ),
									'mobile'  => __( 'Phones only', 'contextchat' ),
									'desktop' => __( 'Larger screens only', 'contextchat' ),
								)
							);
							?>
						</table>
						<div class="ctxc-preview" aria-hidden="true">
							<p class="ctxc-preview-title"><?php esc_html_e( 'Preview', 'contextchat' ); ?></p>
							<div class="ctxc-preview-stage">
								<span class="ctxc-launcher ctxc-preview-launcher">
									<span class="ctxc-launcher-icon"><?php echo ContextChat_Frontend::icon(); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static SVG. ?></span>
									<span class="ctxc-launcher-label"></span>
								</span>
							</div>
						</div>
					</div>

					<h2><?php esc_html_e( 'Chat panel', 'contextchat' ); ?></h2>
					<table class="form-table" role="presentation">
						<?php
						self::row_text( 'header_title', __( 'Title', 'contextchat' ) );
						self::row_text( 'header_subtitle', __( 'Subtitle', 'contextchat' ) );
						self::row_textarea( 'greeting', __( 'Greeting', 'contextchat' ), __( 'Shown as a chat bubble at the top of the panel.', 'contextchat' ) );
						?>
					</table>
				</section>

				<section id="ctxc-tab-hours" class="ctxc-tab" data-tab="hours">
					<h2><?php esc_html_e( 'Opening hours', 'contextchat' ); ?></h2>
					<p>
						<?php
						printf(
							/* translators: %s: time zone name. */
							esc_html__( 'Times are in the site time zone (%s), set under Settings → General. Agents marked "always available" ignore these hours.', 'contextchat' ),
							'<strong>' . esc_html( wp_timezone_string() ) . '</strong>'
						);
						?>
					</p>
					<table class="form-table" role="presentation">
						<?php self::row_checkbox( 'hours_enabled', __( 'Use opening hours', 'contextchat' ), __( 'Outside these hours agents show as offline.', 'contextchat' ) ); ?>
						<tr>
							<th scope="row"><?php esc_html_e( 'Weekly schedule', 'contextchat' ); ?></th>
							<td>
								<table class="ctxc-hours">
									<?php
									global $wp_locale;
									$order = array( 1, 2, 3, 4, 5, 6, 0 );
									foreach ( $order as $day ) :
										$row  = $s['hours'][ $day ];
										$base = ContextChat_Settings::OPTION . '[hours][' . $day . ']';
										?>
										<tr>
											<td><label><input type="checkbox" name="<?php echo esc_attr( $base ); ?>[on]" value="1" <?php checked( $row['on'] ); ?>> <?php echo esc_html( $wp_locale->get_weekday( $day ) ); ?></label></td>
											<td><input type="time" name="<?php echo esc_attr( $base ); ?>[start]" value="<?php echo esc_attr( $row['start'] ); ?>" aria-label="<?php echo esc_attr( sprintf( /* translators: %s: weekday. */ __( '%s opening time', 'contextchat' ), $wp_locale->get_weekday( $day ) ) ); ?>"></td>
											<td>–</td>
											<td><input type="time" name="<?php echo esc_attr( $base ); ?>[end]" value="<?php echo esc_attr( $row['end'] ); ?>" aria-label="<?php echo esc_attr( sprintf( /* translators: %s: weekday. */ __( '%s closing time', 'contextchat' ), $wp_locale->get_weekday( $day ) ) ); ?>"></td>
										</tr>
									<?php endforeach; ?>
								</table>
								<p class="description"><?php esc_html_e( 'A closing time earlier than the opening time runs past midnight.', 'contextchat' ); ?></p>
							</td>
						</tr>
						<?php
						self::row_select(
							'offline_behavior',
							__( 'When everyone is offline', 'contextchat' ),
							array(
								'note' => __( 'Keep the button and show the offline note', 'contextchat' ),
								'hide' => __( 'Hide the floating button', 'contextchat' ),
							)
						);
						self::row_textarea( 'offline_note', __( 'Offline note', 'contextchat' ), __( 'Shown in the panel outside opening hours.', 'contextchat' ) );
						self::row_textarea( 'offline_suffix', __( 'Add to messages sent while offline', 'contextchat' ), __( 'Optional, e.g. "(Sent outside business hours.)" so your team knows when it arrived.', 'contextchat' ) );
						?>
					</table>
				</section>

				<section id="ctxc-tab-advanced" class="ctxc-tab" data-tab="advanced">
					<h2><?php esc_html_e( 'WooCommerce', 'contextchat' ); ?></h2>
					<?php if ( ! class_exists( 'WooCommerce' ) ) : ?>
						<p class="description"><?php esc_html_e( 'WooCommerce is not active. These settings take effect once it is.', 'contextchat' ); ?></p>
					<?php endif; ?>
					<table class="form-table" role="presentation">
						<?php
						self::row_checkbox( 'woo_button', __( 'Product button', 'contextchat' ), __( 'Add an "Ask about this product" button under Add to cart.', 'contextchat' ) );
						self::row_text( 'woo_button_text', __( 'Product button text', 'contextchat' ) );
						?>
						<tr>
							<th scope="row"><?php esc_html_e( 'Product message', 'contextchat' ); ?></th>
							<td><?php self::template_field( 'woo_message', $s['woo_message'] ); ?></td>
						</tr>
					</table>

					<h2><?php esc_html_e( 'Where the button appears', 'contextchat' ); ?></h2>
					<table class="form-table" role="presentation">
						<?php
						self::row_text( 'exclude_ids', __( 'Hide on these page IDs', 'contextchat' ), __( 'Comma separated, e.g. 12, 48. You can also hide it from the page editor.', 'contextchat' ) );
						self::row_textarea( 'exclude_paths', __( 'Hide on addresses containing', 'contextchat' ), __( 'One per line, e.g. /checkout/ or /my-account/.', 'contextchat' ) );
						self::row_select(
							'desktop_target',
							__( 'On computers, open', 'contextchat' ),
							array(
								'web' => __( 'WhatsApp Web in the browser', 'contextchat' ),
								'app' => __( 'The WhatsApp desktop app (via wa.me)', 'contextchat' ),
							)
						);
						?>
					</table>

					<h2><?php esc_html_e( 'Analytics', 'contextchat' ); ?></h2>
					<table class="form-table" role="presentation">
						<?php
						self::row_checkbox( 'analytics', __( 'Count clicks', 'contextchat' ), __( 'Stores the page, agent and device type of each click. No IP addresses, cookies or message text.', 'contextchat' ) );
						self::row_checkbox( 'datalayer', __( 'Send events to Google Analytics / Tag Manager', 'contextchat' ), __( 'Pushes a contextchat_click event to dataLayer and gtag when they are on the page.', 'contextchat' ) );
						self::row_number( 'retention_days', __( 'Keep click data for (days)', 'contextchat' ), 7, 3650 );
						?>
					</table>
				</section>

				<?php submit_button(); ?>
			</form>
		</div>
		<?php
	}

	/**
	 * One agent row.
	 *
	 * @param string $i     Index.
	 * @param array  $agent Agent.
	 */
	private static function agent_row( $i, array $agent ) {
		$agent = array_merge(
			array(
				'id'       => '',
				'name'     => '',
				'role'     => '',
				'phone'    => '',
				'avatar'   => '',
				'always'   => false,
				'disabled' => false,
			),
			$agent
		);
		$base  = ContextChat_Settings::OPTION . '[agents][' . $i . ']';
		$uid   = 'ctxc-agent-' . $i;
		?>
		<div class="ctxc-row ctxc-agent-row">
			<span class="ctxc-handle dashicons dashicons-move" title="<?php esc_attr_e( 'Drag to reorder', 'contextchat' ); ?>"></span>
			<input type="hidden" name="<?php echo esc_attr( $base ); ?>[id]" value="<?php echo esc_attr( $agent['id'] ); ?>">
			<div class="ctxc-avatar-pick">
				<input type="hidden" class="ctxc-avatar-url" name="<?php echo esc_attr( $base ); ?>[avatar]" value="<?php echo esc_attr( $agent['avatar'] ); ?>">
				<button type="button" class="ctxc-avatar-btn" aria-label="<?php esc_attr_e( 'Choose avatar', 'contextchat' ); ?>" style="<?php echo $agent['avatar'] ? esc_attr( 'background-image:url(' . esc_url( $agent['avatar'] ) . ')' ) : ''; ?>"><span class="dashicons dashicons-format-image"></span></button>
			</div>
			<div class="ctxc-fields">
				<label for="<?php echo esc_attr( $uid ); ?>-name"><?php esc_html_e( 'Name', 'contextchat' ); ?>
					<input type="text" id="<?php echo esc_attr( $uid ); ?>-name" name="<?php echo esc_attr( $base ); ?>[name]" value="<?php echo esc_attr( $agent['name'] ); ?>" placeholder="<?php esc_attr_e( 'e.g. Rina', 'contextchat' ); ?>">
				</label>
				<label for="<?php echo esc_attr( $uid ); ?>-role"><?php esc_html_e( 'Role', 'contextchat' ); ?>
					<input type="text" id="<?php echo esc_attr( $uid ); ?>-role" name="<?php echo esc_attr( $base ); ?>[role]" value="<?php echo esc_attr( $agent['role'] ); ?>" placeholder="<?php esc_attr_e( 'e.g. Sales', 'contextchat' ); ?>">
				</label>
				<label for="<?php echo esc_attr( $uid ); ?>-phone"><?php esc_html_e( 'WhatsApp number', 'contextchat' ); ?>
					<input type="tel" id="<?php echo esc_attr( $uid ); ?>-phone" name="<?php echo esc_attr( $base ); ?>[phone]" value="<?php echo esc_attr( $agent['phone'] ? '+' . $agent['phone'] : '' ); ?>" placeholder="+62 812 3456 7890" required>
				</label>
				<label class="ctxc-inline-check"><input type="checkbox" name="<?php echo esc_attr( $base ); ?>[always]" value="1" <?php checked( $agent['always'] ); ?>> <?php esc_html_e( 'Always available', 'contextchat' ); ?></label>
				<label class="ctxc-inline-check"><input type="checkbox" name="<?php echo esc_attr( $base ); ?>[disabled]" value="1" <?php checked( $agent['disabled'] ); ?>> <?php esc_html_e( 'Paused', 'contextchat' ); ?></label>
				<?php if ( '' !== $agent['id'] ) : ?>
					<span class="ctxc-id"><?php echo esc_html( sprintf( /* translators: %s: agent ID. */ __( 'ID: %s', 'contextchat' ), $agent['id'] ) ); ?></span>
				<?php endif; ?>
			</div>
			<button type="button" class="button-link ctxc-remove" aria-label="<?php esc_attr_e( 'Remove agent', 'contextchat' ); ?>"><span class="dashicons dashicons-trash"></span></button>
		</div>
		<?php
	}

	/**
	 * One rule row.
	 *
	 * @param string $i      Index.
	 * @param array  $rule   Rule.
	 * @param array  $agents Saved agents.
	 */
	private static function rule_row( $i, array $rule, array $agents ) {
		$rule  = array_merge(
			array(
				'id'      => '',
				'label'   => '',
				'type'    => 'url_contains',
				'value'   => '',
				'message' => '',
				'agents'  => array(),
			),
			$rule
		);
		$base  = ContextChat_Settings::OPTION . '[rules][' . $i . ']';
		$uid   = 'ctxc-rule-' . $i;
		$types = array(
			'url_contains'     => __( 'Address contains', 'contextchat' ),
			'page'             => __( 'Page or post (ID or slug)', 'contextchat' ),
			'post_type'        => __( 'Content type (e.g. post, page, product)', 'contextchat' ),
			'category'         => __( 'Post category (slug)', 'contextchat' ),
			'product_category' => __( 'Product category (slug)', 'contextchat' ),
			'product'          => __( 'Any product page', 'contextchat' ),
			'front_page'       => __( 'Home page', 'contextchat' ),
			'search'           => __( 'Search results', 'contextchat' ),
		);
		?>
		<div class="ctxc-row ctxc-rule-row">
			<span class="ctxc-handle dashicons dashicons-move" title="<?php esc_attr_e( 'Drag to reorder', 'contextchat' ); ?>"></span>
			<input type="hidden" name="<?php echo esc_attr( $base ); ?>[id]" value="<?php echo esc_attr( $rule['id'] ); ?>">
			<div class="ctxc-fields">
				<label for="<?php echo esc_attr( $uid ); ?>-label"><?php esc_html_e( 'Name (for you)', 'contextchat' ); ?>
					<input type="text" id="<?php echo esc_attr( $uid ); ?>-label" name="<?php echo esc_attr( $base ); ?>[label]" value="<?php echo esc_attr( $rule['label'] ); ?>" placeholder="<?php esc_attr_e( 'e.g. Visa pages', 'contextchat' ); ?>">
				</label>
				<label for="<?php echo esc_attr( $uid ); ?>-type"><?php esc_html_e( 'When', 'contextchat' ); ?>
					<select id="<?php echo esc_attr( $uid ); ?>-type" name="<?php echo esc_attr( $base ); ?>[type]" class="ctxc-rule-type">
						<?php foreach ( $types as $value => $label ) : ?>
							<option value="<?php echo esc_attr( $value ); ?>" <?php selected( $rule['type'], $value ); ?>><?php echo esc_html( $label ); ?></option>
						<?php endforeach; ?>
					</select>
				</label>
				<label for="<?php echo esc_attr( $uid ); ?>-value" class="ctxc-rule-value"><?php esc_html_e( 'Matches', 'contextchat' ); ?>
					<input type="text" id="<?php echo esc_attr( $uid ); ?>-value" name="<?php echo esc_attr( $base ); ?>[value]" value="<?php echo esc_attr( $rule['value'] ); ?>" placeholder="<?php esc_attr_e( 'e.g. /visa, passport', 'contextchat' ); ?>">
				</label>
				<div class="ctxc-wide">
					<span class="ctxc-field-label"><?php esc_html_e( 'Message', 'contextchat' ); ?></span>
					<?php self::template_field( '', $rule['message'], $base . '[message]', __( 'Leave empty to keep the default message and only change the agents.', 'contextchat' ) ); ?>
				</div>
				<?php if ( $agents ) : ?>
					<fieldset class="ctxc-wide ctxc-rule-agents">
						<legend><?php esc_html_e( 'Route to (none ticked = all agents)', 'contextchat' ); ?></legend>
						<?php foreach ( $agents as $agent ) : ?>
							<label class="ctxc-inline-check"><input type="checkbox" name="<?php echo esc_attr( $base ); ?>[agents][]" value="<?php echo esc_attr( $agent['id'] ); ?>" <?php checked( in_array( $agent['id'], $rule['agents'], true ) ); ?>> <?php echo esc_html( '' !== $agent['name'] ? $agent['name'] : '+' . $agent['phone'] ); ?></label>
						<?php endforeach; ?>
					</fieldset>
				<?php endif; ?>
			</div>
			<button type="button" class="button-link ctxc-remove" aria-label="<?php esc_attr_e( 'Remove rule', 'contextchat' ); ?>"><span class="dashicons dashicons-trash"></span></button>
		</div>
		<?php
	}

	/**
	 * Message template editor with placeholder chips and a live preview.
	 *
	 * @param string $key   Setting key, or '' when $name is given.
	 * @param string $value Current template.
	 * @param string $name  Field name override.
	 * @param string $help  Help text.
	 */
	private static function template_field( $key, $value, $name = '', $help = '' ) {
		$name = '' !== $name ? $name : ContextChat_Settings::OPTION . '[' . $key . ']';
		$id   = 'ctxc-tpl-' . md5( $name );
		?>
		<div class="ctxc-template">
			<label class="screen-reader-text" for="<?php echo esc_attr( $id ); ?>"><?php esc_html_e( 'Message template', 'contextchat' ); ?></label>
			<textarea id="<?php echo esc_attr( $id ); ?>" name="<?php echo esc_attr( $name ); ?>" rows="3" class="large-text ctxc-template-input"><?php echo esc_textarea( $value ); ?></textarea>
			<div class="ctxc-chips" role="group" aria-label="<?php esc_attr_e( 'Insert a placeholder', 'contextchat' ); ?>">
				<?php foreach ( ContextChat_Template::placeholders() as $ph => $info ) : ?>
					<button type="button" class="ctxc-chip ctxc-chip--<?php echo esc_attr( $info['scope'] ); ?>" data-insert="{<?php echo esc_attr( $ph ); ?>}" title="<?php echo esc_attr( $info['label'] ); ?>">{<?php echo esc_html( $ph ); ?>}</button>
				<?php endforeach; ?>
			</div>
			<p class="ctxc-template-preview"><span class="ctxc-preview-label"><?php esc_html_e( 'Preview:', 'contextchat' ); ?></span> <span class="ctxc-preview-text"></span></p>
			<p class="description">
				<?php
				echo esc_html( '' !== $help ? $help . ' ' : '' );
				esc_html_e( 'Write {name|fallback} to use the fallback when a value is empty, e.g. {product_name|your services}.', 'contextchat' );
				?>
			</p>
		</div>
		<?php
	}

	/**
	 * Text-like input row.
	 *
	 * @param string $key   Setting key.
	 * @param string $label Label.
	 * @param string $desc  Description.
	 * @param string $type  Input type.
	 * @param string $class CSS class.
	 */
	private static function row_text( $key, $label, $desc = '', $type = 'text', $class = 'regular-text' ) {
		$s     = ContextChat_Settings::get();
		$value = (string) $s[ $key ];
		if ( 'phone' === $key && '' !== $value ) {
			$value = '+' . $value;
		}
		$id = 'ctxc-' . $key;
		?>
		<tr>
			<th scope="row"><label for="<?php echo esc_attr( $id ); ?>"><?php echo esc_html( $label ); ?></label></th>
			<td>
				<input type="<?php echo esc_attr( $type ); ?>" id="<?php echo esc_attr( $id ); ?>" name="<?php echo esc_attr( ContextChat_Settings::OPTION . '[' . $key . ']' ); ?>" value="<?php echo esc_attr( $value ); ?>" class="<?php echo esc_attr( 'color' === $type ? 'ctxc-color' : $class ); ?>" data-key="<?php echo esc_attr( $key ); ?>">
				<?php if ( '' !== $desc ) : ?>
					<p class="description"><?php echo esc_html( $desc ); ?></p>
				<?php endif; ?>
			</td>
		</tr>
		<?php
	}

	/**
	 * Number input row.
	 *
	 * @param string $key   Setting key.
	 * @param string $label Label.
	 * @param int    $min   Minimum.
	 * @param int    $max   Maximum.
	 */
	private static function row_number( $key, $label, $min, $max ) {
		$s  = ContextChat_Settings::get();
		$id = 'ctxc-' . $key;
		?>
		<tr>
			<th scope="row"><label for="<?php echo esc_attr( $id ); ?>"><?php echo esc_html( $label ); ?></label></th>
			<td><input type="number" id="<?php echo esc_attr( $id ); ?>" name="<?php echo esc_attr( ContextChat_Settings::OPTION . '[' . $key . ']' ); ?>" value="<?php echo esc_attr( (string) $s[ $key ] ); ?>" min="<?php echo esc_attr( (string) $min ); ?>" max="<?php echo esc_attr( (string) $max ); ?>" class="small-text" data-key="<?php echo esc_attr( $key ); ?>"></td>
		</tr>
		<?php
	}

	/**
	 * Textarea row.
	 *
	 * @param string $key   Setting key.
	 * @param string $label Label.
	 * @param string $desc  Description.
	 */
	private static function row_textarea( $key, $label, $desc = '' ) {
		$s  = ContextChat_Settings::get();
		$id = 'ctxc-' . $key;
		?>
		<tr>
			<th scope="row"><label for="<?php echo esc_attr( $id ); ?>"><?php echo esc_html( $label ); ?></label></th>
			<td>
				<textarea id="<?php echo esc_attr( $id ); ?>" name="<?php echo esc_attr( ContextChat_Settings::OPTION . '[' . $key . ']' ); ?>" rows="3" class="large-text"><?php echo esc_textarea( (string) $s[ $key ] ); ?></textarea>
				<?php if ( '' !== $desc ) : ?>
					<p class="description"><?php echo esc_html( $desc ); ?></p>
				<?php endif; ?>
			</td>
		</tr>
		<?php
	}

	/**
	 * Checkbox row.
	 *
	 * @param string $key   Setting key.
	 * @param string $label Label.
	 * @param string $desc  Description.
	 */
	private static function row_checkbox( $key, $label, $desc = '' ) {
		$s  = ContextChat_Settings::get();
		$id = 'ctxc-' . $key;
		?>
		<tr>
			<th scope="row"><?php echo esc_html( $label ); ?></th>
			<td>
				<label for="<?php echo esc_attr( $id ); ?>">
					<input type="checkbox" id="<?php echo esc_attr( $id ); ?>" name="<?php echo esc_attr( ContextChat_Settings::OPTION . '[' . $key . ']' ); ?>" value="1" <?php checked( ! empty( $s[ $key ] ) ); ?> data-key="<?php echo esc_attr( $key ); ?>">
					<?php echo esc_html( '' !== $desc ? $desc : $label ); ?>
				</label>
			</td>
		</tr>
		<?php
	}

	/**
	 * Select row.
	 *
	 * @param string $key     Setting key.
	 * @param string $label   Label.
	 * @param array  $options Value => label.
	 */
	private static function row_select( $key, $label, array $options ) {
		$s  = ContextChat_Settings::get();
		$id = 'ctxc-' . $key;
		?>
		<tr>
			<th scope="row"><label for="<?php echo esc_attr( $id ); ?>"><?php echo esc_html( $label ); ?></label></th>
			<td>
				<select id="<?php echo esc_attr( $id ); ?>" name="<?php echo esc_attr( ContextChat_Settings::OPTION . '[' . $key . ']' ); ?>" data-key="<?php echo esc_attr( $key ); ?>">
					<?php foreach ( $options as $value => $text ) : ?>
						<option value="<?php echo esc_attr( $value ); ?>" <?php selected( $s[ $key ], $value ); ?>><?php echo esc_html( $text ); ?></option>
					<?php endforeach; ?>
				</select>
			</td>
		</tr>
		<?php
	}

	/**
	 * Analytics screen.
	 */
	public static function analytics_page() {
		if ( ! current_user_can( self::CAP ) ) {
			return;
		}
		$days = isset( $_GET['range'] ) ? absint( $_GET['range'] ) : 30; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only filter.
		$days = in_array( $days, self::RANGES, true ) ? $days : 30;
		$r    = ContextChat_Analytics::report( $days );
		$s    = ContextChat_Settings::get();

		$names = array( 'main' => __( 'Main number', 'contextchat' ) );
		foreach ( $s['agents'] as $agent ) {
			$names[ $agent['id'] ] = '' !== $agent['name'] ? $agent['name'] : '+' . $agent['phone'];
		}
		$sources = array(
			'float'     => __( 'Floating button', 'contextchat' ),
			'shortcode' => __( 'Shortcode', 'contextchat' ),
			'block'     => __( 'Block', 'contextchat' ),
			'product'   => __( 'Product button', 'contextchat' ),
		);
		$change = $r['previous'] > 0 ? round( ( $r['total'] - $r['previous'] ) / $r['previous'] * 100 ) : null;
		$max    = max( 1, max( $r['daily'] ) );
		?>
		<div class="wrap ctxc-admin">
			<h1><?php esc_html_e( 'ContextChat Analytics', 'contextchat' ); ?></h1>
			<?php if ( empty( $s['analytics'] ) ) : ?>
				<div class="notice notice-warning inline"><p><?php esc_html_e( 'Click counting is turned off in Settings → WooCommerce & advanced.', 'contextchat' ); ?></p></div>
			<?php endif; ?>

			<div class="ctxc-range">
				<?php foreach ( self::RANGES as $range ) : ?>
					<a class="button <?php echo $range === $days ? 'button-primary' : ''; ?>" href="<?php echo esc_url( add_query_arg( 'range', $range ) ); ?>" <?php echo $range === $days ? 'aria-current="page"' : ''; ?>>
						<?php echo esc_html( sprintf( /* translators: %d: number of days. */ __( 'Last %d days', 'contextchat' ), $range ) ); ?>
					</a>
				<?php endforeach; ?>
				<a class="button" href="<?php echo esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=contextchat_export&range=' . $days ), 'contextchat_export' ) ); ?>"><?php esc_html_e( 'Export CSV', 'contextchat' ); ?></a>
			</div>

			<div class="ctxc-cards">
				<div class="ctxc-card">
					<p class="ctxc-card-label"><?php esc_html_e( 'Chats started', 'contextchat' ); ?></p>
					<p class="ctxc-card-value"><?php echo esc_html( number_format_i18n( $r['total'] ) ); ?></p>
					<?php if ( null !== $change ) : ?>
						<p class="ctxc-card-note <?php echo $change >= 0 ? 'is-up' : 'is-down'; ?>">
							<?php echo esc_html( sprintf( /* translators: 1: signed percent change, 2: days. */ __( '%1$s%% vs the previous %2$d days', 'contextchat' ), ( $change > 0 ? '+' : '' ) . $change, $days ) ); ?>
						</p>
					<?php endif; ?>
				</div>
				<div class="ctxc-card">
					<p class="ctxc-card-label"><?php esc_html_e( 'Daily average', 'contextchat' ); ?></p>
					<p class="ctxc-card-value"><?php echo esc_html( number_format_i18n( $r['total'] / $days, 1 ) ); ?></p>
				</div>
				<div class="ctxc-card">
					<p class="ctxc-card-label"><?php esc_html_e( 'From phones', 'contextchat' ); ?></p>
					<p class="ctxc-card-value">
						<?php
						$mobile = 0;
						foreach ( $r['devices'] as $row ) {
							if ( 'mobile' === $row['device'] ) {
								$mobile = (int) $row['n'];
							}
						}
						echo esc_html( $r['total'] ? round( $mobile / $r['total'] * 100 ) . '%' : '–' );
						?>
					</p>
				</div>
			</div>

			<div class="ctxc-panel-box">
				<h2><?php esc_html_e( 'Chats per day', 'contextchat' ); ?></h2>
				<div class="ctxc-chart" role="img" aria-label="<?php echo esc_attr( sprintf( /* translators: 1: total, 2: days. */ __( '%1$d chats over %2$d days', 'contextchat' ), $r['total'], $days ) ); ?>">
					<?php foreach ( $r['daily'] as $date => $n ) : ?>
						<span class="ctxc-bar" style="<?php echo esc_attr( 'height:' . max( 2, round( $n / $max * 100 ) ) . '%' ); ?>" title="<?php echo esc_attr( date_i18n( get_option( 'date_format' ), strtotime( $date ) ) . ': ' . $n ); ?>"></span>
					<?php endforeach; ?>
				</div>
			</div>

			<div class="ctxc-grid">
				<div class="ctxc-panel-box">
					<h2><?php esc_html_e( 'Top pages', 'contextchat' ); ?></h2>
					<?php if ( $r['pages'] ) : ?>
						<table class="widefat striped">
							<thead><tr><th><?php esc_html_e( 'Page', 'contextchat' ); ?></th><th class="num"><?php esc_html_e( 'Chats', 'contextchat' ); ?></th></tr></thead>
							<tbody>
								<?php foreach ( $r['pages'] as $row ) : ?>
									<?php $title = $row['post_id'] ? get_the_title( (int) $row['post_id'] ) : ''; ?>
									<tr>
										<td><?php echo esc_html( '' !== $title ? $title : $row['path'] ); ?><br><code><?php echo esc_html( $row['path'] ); ?></code></td>
										<td class="num"><?php echo esc_html( number_format_i18n( (int) $row['n'] ) ); ?></td>
									</tr>
								<?php endforeach; ?>
							</tbody>
						</table>
					<?php else : ?>
						<p><?php esc_html_e( 'No chats yet in this period.', 'contextchat' ); ?></p>
					<?php endif; ?>
				</div>
				<div class="ctxc-panel-box">
					<h2><?php esc_html_e( 'By agent', 'contextchat' ); ?></h2>
					<?php self::share_list( $r['agents'], 'agent', $names, $r['total'] ); ?>
					<h2><?php esc_html_e( 'By button', 'contextchat' ); ?></h2>
					<?php self::share_list( $r['sources'], 'source', $sources, $r['total'] ); ?>
				</div>
			</div>
		</div>
		<?php
	}

	/**
	 * A list of shares with bars.
	 *
	 * @param array  $rows  Rows with a key column and n.
	 * @param string $col   Key column.
	 * @param array  $names Display names.
	 * @param int    $total Total for percentages.
	 */
	private static function share_list( array $rows, $col, array $names, $total ) {
		if ( ! $rows ) {
			echo '<p>' . esc_html__( 'No data yet.', 'contextchat' ) . '</p>';
			return;
		}
		echo '<ul class="ctxc-shares">';
		foreach ( $rows as $row ) {
			$key   = (string) $row[ $col ];
			$label = isset( $names[ $key ] ) ? $names[ $key ] : ( '' !== $key ? $key : __( 'Unknown', 'contextchat' ) );
			$pct   = $total ? round( (int) $row['n'] / $total * 100 ) : 0;
			printf(
				'<li><span class="ctxc-share-label">%1$s</span><span class="ctxc-share-n">%2$s</span><span class="ctxc-share-bar"><span style="%3$s"></span></span></li>',
				esc_html( $label ),
				esc_html( number_format_i18n( (int) $row['n'] ) . ' · ' . $pct . '%' ),
				esc_attr( 'width:' . $pct . '%' )
			);
		}
		echo '</ul>';
	}

	/**
	 * Download clicks as CSV.
	 */
	public static function export() {
		if ( ! current_user_can( self::CAP ) ) {
			wp_die( esc_html__( 'You are not allowed to export this data.', 'contextchat' ), 403 );
		}
		check_admin_referer( 'contextchat_export' );
		$days = isset( $_GET['range'] ) ? absint( $_GET['range'] ) : 30;
		$days = in_array( $days, self::RANGES, true ) ? $days : 30;

		nocache_headers();
		header( 'Content-Type: text/csv; charset=utf-8' );
		header( 'Content-Disposition: attachment; filename=contextchat-clicks-' . gmdate( 'Y-m-d' ) . '.csv' );

		$out = fopen( 'php://output', 'w' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fopen
		fputcsv( $out, array( 'time_utc', 'post_id', 'path', 'agent', 'rule', 'source', 'device' ) );
		foreach ( ContextChat_Analytics::rows( $days ) as $row ) {
			// Neutralise spreadsheet formulas in text cells.
			$row = array_map(
				static function ( $v ) {
					return preg_match( '/^[=+\-@\t\r]/', (string) $v ) ? "'" . $v : $v;
				},
				$row
			);
			fputcsv( $out, $row );
		}
		fclose( $out ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose
		exit;
	}
}
