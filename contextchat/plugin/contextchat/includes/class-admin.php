<?php
/**
 * Admin: the menu and the settings screen. The analytics report is in class-admin-analytics.php.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Admin screens.
 */
class ContextChat_Admin {

	const SLUG = 'contextchat';
	const CAP  = 'manage_options';

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'assets' ) );
		add_action( 'admin_notices', array( __CLASS__, 'setup_notice' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( CONTEXTCHAT_FILE ), array( __CLASS__, 'action_links' ) );
	}

	/**
	 * Menu entries.
	 */
	public static function menu() {
		add_menu_page( __( 'ContextChat', 'contextchat' ), __( 'ContextChat', 'contextchat' ), self::CAP, self::SLUG, array( __CLASS__, 'settings_page' ), 'dashicons-format-chat', 81 );
		add_submenu_page( self::SLUG, __( 'ContextChat Settings', 'contextchat' ), __( 'Settings', 'contextchat' ), self::CAP, self::SLUG, array( __CLASS__, 'settings_page' ) );
		add_submenu_page( self::SLUG, __( 'ContextChat Analytics', 'contextchat' ), __( 'Analytics', 'contextchat' ), self::CAP, self::SLUG . '-analytics', array( 'ContextChat_Admin_Analytics', 'page' ) );
		add_submenu_page( self::SLUG, __( 'SI conversations', 'contextchat' ), __( 'Conversations', 'contextchat' ), self::CAP, ContextChat_Admin_Conversations::SLUG, array( 'ContextChat_Admin_Conversations', 'page' ) );
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
		// The media library is only needed for agent photos, on the settings screen.
		if ( false === strpos( $hook, self::SLUG . '-analytics' ) ) {
			wp_enqueue_media();
		}
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
				'samples'    => $samples,
				'valueRules' => ContextChat_Settings::RULE_TYPES_WITH_VALUE,
				'siTest'     => array(
					'url'   => esc_url_raw( rest_url( 'contextchat/v1/admin/si-test' ) ),
					'nonce' => wp_create_nonce( 'wp_rest' ),
				),
				'i18n'       => array(
					'chooseAvatar'  => __( 'Choose avatar', 'contextchat' ),
					'useImage'      => __( 'Use this image', 'contextchat' ),
					'confirmRemove' => __( 'Remove this row?', 'contextchat' ),
					'testing'       => __( 'Sending a test message…', 'contextchat' ),
					/* translators: %s: model ID. */
					'testOk'        => __( 'Connected. Reply from %s:', 'contextchat' ),
					'testFailed'    => __( 'The test did not get a usable reply.', 'contextchat' ),
					/* translators: 1: attempt number, 2: model ID, 3: what happened, 4: milliseconds, 5: input tokens, 6: output tokens, 7: cost in dollars. */
					'attempt'       => __( 'Attempt %1$d: %2$s, %3$s, %4$d ms, %5$d tokens in, %6$d tokens out, about $%7$s', 'contextchat' ),
					/* translators: 1: dollars spent today, 2: daily cap in dollars. */
					'spentToday'    => __( 'Spent today: about $%1$s of $%2$s.', 'contextchat' ),
					'outcomes'      => self::outcome_labels(),
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
			'si'         => __( 'SI', 'contextchat' ),
			'knowledge'  => __( 'Knowledge', 'contextchat' ),
			'voice'      => __( 'Voice', 'contextchat' ),
			'prices'     => __( 'Prices', 'contextchat' ),
			'privacy'    => __( 'Privacy', 'contextchat' ),
		);
		?>
		<div class="wrap ctxc-admin">
			<h1><?php esc_html_e( 'ContextChat', 'contextchat' ); ?></h1>
			<p class="ctxc-lede"><?php esc_html_e( 'A chat button that tells you what the visitor was looking at before they wrote to you.', 'contextchat' ); ?></p>
			<?php settings_errors(); ?>

			<nav class="nav-tab-wrapper ctxc-tabs" role="tablist">
				<?php foreach ( $tabs as $id => $label ) : ?>
					<a href="#ctxc-tab-<?php echo esc_attr( $id ); ?>" id="ctxc-tablink-<?php echo esc_attr( $id ); ?>" class="nav-tab" role="tab" aria-controls="ctxc-tab-<?php echo esc_attr( $id ); ?>" data-tab="<?php echo esc_attr( $id ); ?>"><?php echo esc_html( $label ); ?></a>
				<?php endforeach; ?>
			</nav>

			<form method="post" action="options.php" class="ctxc-form">
				<?php settings_fields( 'contextchat' ); ?>

				<section id="ctxc-tab-general" class="ctxc-tab" data-tab="general" aria-labelledby="ctxc-tablink-general">
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

				<section id="ctxc-tab-routing" class="ctxc-tab" data-tab="routing" aria-labelledby="ctxc-tablink-routing">
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

				<section id="ctxc-tab-appearance" class="ctxc-tab" data-tab="appearance" aria-labelledby="ctxc-tablink-appearance">
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

				<section id="ctxc-tab-hours" class="ctxc-tab" data-tab="hours" aria-labelledby="ctxc-tablink-hours">
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

				<section id="ctxc-tab-advanced" class="ctxc-tab" data-tab="advanced" aria-labelledby="ctxc-tablink-advanced">
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

				<?php self::si_tab(); ?>
				<?php self::knowledge_tab(); ?>
				<?php self::voice_tab(); ?>
				<?php self::prices_tab(); ?>
				<?php self::privacy_tab(); ?>

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
				<button type="button" class="ctxc-avatar-btn" aria-label="<?php esc_attr_e( 'Choose avatar', 'contextchat' ); ?>" style="<?php echo $agent['avatar'] ? esc_attr( 'background-image:url("' . esc_url( $agent['avatar'] ) . '")' ) : ''; ?>"><span class="dashicons dashicons-format-image"></span></button>
				<button type="button" class="button-link ctxc-avatar-remove" <?php echo $agent['avatar'] ? '' : 'hidden'; ?>><?php esc_html_e( 'Remove photo', 'contextchat' ); ?></button>
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
							<label class="ctxc-inline-check"><input type="checkbox" name="<?php echo esc_attr( $base ); ?>[agents][]" value="<?php echo esc_attr( $agent['id'] ); ?>" <?php checked( in_array( $agent['id'], $rule['agents'], true ) ); ?>> <?php echo esc_html( ContextChat_Settings::agent_label( $agent ) ); ?></label>
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
		$name   = '' !== $name ? $name : ContextChat_Settings::OPTION . '[' . $key . ']';
		// Built from the field name, so a row cloned from the <template> gets its own ID with its index.
		$id     = 'ctxc-tpl-' . trim( preg_replace( '/[^A-Za-z0-9_]+/', '-', $name ), '-' );
		$labels = self::placeholder_labels();
		?>
		<div class="ctxc-template">
			<label class="screen-reader-text" for="<?php echo esc_attr( $id ); ?>"><?php esc_html_e( 'Message template', 'contextchat' ); ?></label>
			<textarea id="<?php echo esc_attr( $id ); ?>" name="<?php echo esc_attr( $name ); ?>" rows="3" class="large-text ctxc-template-input"><?php echo esc_textarea( $value ); ?></textarea>
			<div class="ctxc-chips" role="group" aria-label="<?php esc_attr_e( 'Insert a placeholder', 'contextchat' ); ?>">
				<?php foreach ( ContextChat_Template::placeholders() as $ph => $info ) : ?>
					<button type="button" class="ctxc-chip ctxc-chip--<?php echo esc_attr( $info['scope'] ); ?>" data-insert="{<?php echo esc_attr( $ph ); ?>}" title="<?php echo esc_attr( isset( $labels[ $ph ] ) ? $labels[ $ph ] : $ph ); ?>">{<?php echo esc_html( $ph ); ?>}</button>
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
	 * What each placeholder stands for, shown as the tooltip of its chip.
	 *
	 * @return array<string, string>
	 */
	private static function placeholder_labels() {
		return array(
			'page_title'    => __( 'Page title', 'contextchat' ),
			'page_url'      => __( 'Page address', 'contextchat' ),
			'site_name'     => __( 'Site name', 'contextchat' ),
			'post_type'     => __( 'Content type', 'contextchat' ),
			'category'      => __( 'Category', 'contextchat' ),
			'search_query'  => __( 'Search terms', 'contextchat' ),
			'product_name'  => __( 'Product name', 'contextchat' ),
			'product_price' => __( 'Product price', 'contextchat' ),
			'product_sku'   => __( 'Product SKU', 'contextchat' ),
			'product_stock' => __( 'Stock status', 'contextchat' ),
			'agent_name'    => __( 'Agent name', 'contextchat' ),
			'utm_source'    => __( 'Campaign source', 'contextchat' ),
			'utm_medium'    => __( 'Campaign medium', 'contextchat' ),
			'utm_campaign'  => __( 'Campaign name', 'contextchat' ),
			'referrer'      => __( 'Referring site', 'contextchat' ),
			'date'          => __( 'Visitor date', 'contextchat' ),
			'time'          => __( 'Visitor time', 'contextchat' ),
		);
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
	 * The SI tab: API key, model routing, spending cap and a connection test.
	 */
	private static function si_tab() {
		$s      = ContextChat_Settings::get();
		$source = ContextChat_SI_Secrets::source();
		$meter  = new ContextChat_SI();
		$cap    = (int) $s['si_daily_cap_cents'];
		?>
		<section id="ctxc-tab-si" class="ctxc-tab" data-tab="si" aria-labelledby="ctxc-tablink-si">
			<h2><?php esc_html_e( 'SI (Synthesized Intelligence)', 'contextchat' ); ?></h2>
			<p><?php esc_html_e( 'ContextChat 2.0 adds an SI assistant to the chat panel, powered by Anthropic\'s Claude models. This tab turns it on, holds the API key, chooses which models answer, and caps what the site spends each day. Nothing is sent to Anthropic until the SI chat is turned on, except when you press "Test connection".', 'contextchat' ); ?></p>

			<h3><?php esc_html_e( 'API key', 'contextchat' ); ?></h3>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="ctxc-si_api_key"><?php esc_html_e( 'Anthropic API key', 'contextchat' ); ?></label></th>
					<td>
						<p class="ctxc-si-key-status ctxc-si-key-status--<?php echo esc_attr( $source ); ?>">
							<?php
							switch ( $source ) {
								case 'constant':
									esc_html_e( 'The key is set in wp-config.php (CONTEXTCHAT_ANTHROPIC_KEY). That is the safest place for it; the field below is ignored.', 'contextchat' );
									break;
								case 'stored':
									printf(
										/* translators: %s: date the key was saved. */
										esc_html__( 'A key is saved, encrypted, since %s. It is never shown again. To replace it, enter a new one.', 'contextchat' ),
										esc_html( get_date_from_gmt( ContextChat_SI_Secrets::saved_at(), get_option( 'date_format' ) ) )
									);
									break;
								case 'unreadable':
									esc_html_e( 'A key is saved but can no longer be decrypted, probably because AUTH_KEY in wp-config.php changed. Enter the key again.', 'contextchat' );
									break;
								default:
									esc_html_e( 'No key yet. Create one in the Anthropic Console under API keys, then paste it here.', 'contextchat' );
							}
							?>
						</p>
						<?php if ( 'constant' !== $source ) : ?>
							<input type="password" id="ctxc-si_api_key" name="<?php echo esc_attr( ContextChat_Settings::OPTION . '[si_api_key]' ); ?>" value="" class="regular-text" autocomplete="new-password" spellcheck="false" placeholder="sk-ant-…">
							<?php if ( 'stored' === $source || 'unreadable' === $source ) : ?>
								<p><label><input type="checkbox" name="<?php echo esc_attr( ContextChat_Settings::OPTION . '[si_api_key_remove]' ); ?>" value="1"> <?php esc_html_e( 'Remove the stored key', 'contextchat' ); ?></label></p>
							<?php endif; ?>
							<p class="description"><?php esc_html_e( 'Stored encrypted with a key derived from AUTH_KEY in wp-config.php. For more safety, put it in wp-config.php instead: define( \'CONTEXTCHAT_ANTHROPIC_KEY\', \'sk-ant-…\' );', 'contextchat' ); ?></p>
						<?php endif; ?>
					</td>
				</tr>
			</table>

			<h3><?php esc_html_e( 'SI chat in the panel', 'contextchat' ); ?></h3>
			<p><?php esc_html_e( 'When this is on and a key is saved, visitors chat with the SI in the panel: it answers from the Knowledge tab, collects the details your team needs, gives estimates from the price table, and hands the chat to your team on WhatsApp or by email with a summary. When it is off, the panel works as before. Chat text is sent to Anthropic for processing; mention this in your privacy policy.', 'contextchat' ); ?></p>
			<table class="form-table" role="presentation">
				<?php
				self::row_checkbox( 'si_enabled', __( 'Turn on the SI chat', 'contextchat' ), __( 'Off after updating, so an update never changes your site by surprise.', 'contextchat' ) );
				self::row_text( 'si_business_name', __( 'Business name', 'contextchat' ), __( 'How the SI names your business, e.g. Nusalexia. Empty: the site title.', 'contextchat' ) );
				self::row_text( 'si_handoff_email', __( 'Email for handoffs', 'contextchat' ), __( 'Where the "Email" button writes to, e.g. info@nusalexia.co.id. Empty: the site\'s admin email.', 'contextchat' ), 'email' );
				$agent_choices = array( '' => __( 'First available agent', 'contextchat' ) );
				foreach ( $s['agents'] as $agent ) {
					$agent_choices[ $agent['id'] ] = ContextChat_Settings::agent_label( $agent );
				}
				self::row_select( 'si_agent_translation', __( 'Agent for translation', 'contextchat' ), $agent_choices );
				self::row_select( 'si_agent_interpreting', __( 'Agent for interpreting', 'contextchat' ), $agent_choices );
				self::row_number( 'si_idle_minutes', __( 'Offer the team after silence (minutes)', 'contextchat' ), 1, 30 );
				?>
			</table>

			<h3><?php esc_html_e( 'Model routing', 'contextchat' ); ?></h3>
			<p><?php esc_html_e( 'In automatic mode the fast model writes every reply. When a reply fails ContextChat\'s checks, is declined or is cut off, the stronger model writes it again. Most chats only ever use the fast model.', 'contextchat' ); ?></p>
			<table class="form-table" role="presentation">
				<?php
				self::row_select(
					'si_routing',
					__( 'Routing', 'contextchat' ),
					array(
						'auto'          => __( 'Automatic: fast model first, stronger model when a reply fails a check (recommended)', 'contextchat' ),
						'worker_only'   => __( 'Fast model only (lowest cost, no retry)', 'contextchat' ),
						'executor_only' => __( 'Stronger model for every reply (highest cost)', 'contextchat' ),
					)
				);
				self::row_text( 'si_model_worker', __( 'Fast model', 'contextchat' ), __( 'Writes every reply in automatic mode. Default: claude-haiku-5-5.', 'contextchat' ) );
				self::row_text( 'si_model_executor', __( 'Stronger model', 'contextchat' ), __( 'Writes a reply again when the fast model\'s reply cannot be used. Default: claude-sonnet-5-5.', 'contextchat' ) );
				self::row_select(
					'si_effort',
					__( 'Thinking effort', 'contextchat' ),
					array(
						'low'    => __( 'Low (fastest replies; enough for chat)', 'contextchat' ),
						'medium' => __( 'Medium', 'contextchat' ),
						'high'   => __( 'High (slower, more thorough)', 'contextchat' ),
					)
				);
				self::row_number( 'si_max_tokens', __( 'Longest reply (tokens)', 'contextchat' ), 256, 4096 );
				?>
				<tr>
					<th scope="row"><label for="ctxc-si_daily_cap_usd"><?php esc_html_e( 'Daily spending cap (USD)', 'contextchat' ); ?></label></th>
					<td>
						<input type="number" id="ctxc-si_daily_cap_usd" name="<?php echo esc_attr( ContextChat_Settings::OPTION . '[si_daily_cap_usd]' ); ?>" value="<?php echo esc_attr( number_format( $cap / 100, 2, '.', '' ) ); ?>" min="0.10" max="1000" step="0.01" class="small-text">
						<p class="description ctxc-si-spend">
							<?php
							printf(
								/* translators: 1: dollars spent today, 2: daily cap in dollars. */
								esc_html__( 'Spent today: about $%1$s of $%2$s.', 'contextchat' ),
								esc_html( number_format( $meter->spent_today() / 1000000, 4 ) ),
								esc_html( number_format( $cap / 100, 2 ) )
							);
							?>
							<?php esc_html_e( 'When the cap is reached, no more requests are sent until the next day (site time zone). Costs are estimated from Anthropic\'s published prices.', 'contextchat' ); ?>
						</p>
					</td>
				</tr>
			</table>

			<h3><?php esc_html_e( 'Test connection', 'contextchat' ); ?></h3>
			<p><?php esc_html_e( 'Sends one message to Anthropic with the saved key and settings, and shows which model answered. Save your changes first. A test costs a fraction of a cent and counts toward the daily cap.', 'contextchat' ); ?></p>
			<div class="ctxc-si-test">
				<label for="ctxc-si-test-prompt"><?php esc_html_e( 'Test message', 'contextchat' ); ?></label>
				<textarea id="ctxc-si-test-prompt" rows="2" class="large-text" maxlength="500"><?php echo esc_textarea( __( 'Hello! What is a sworn translation?', 'contextchat' ) ); ?></textarea>
				<p><label><input type="checkbox" id="ctxc-si-test-reject"> <?php esc_html_e( 'Treat the first reply as failing a check, to see the stronger model take over', 'contextchat' ); ?></label></p>
				<p><button type="button" class="button button-secondary" id="ctxc-si-test-run"<?php disabled( 'none' === $source || 'unreadable' === $source ); ?>><?php esc_html_e( 'Test connection', 'contextchat' ); ?></button></p>
				<div class="ctxc-si-test-result" role="status" aria-live="polite"></div>
			</div>
		</section>
		<?php
	}

	/**
	 * Words for the router's outcomes, shown in the connection test.
	 *
	 * @return array<string, string>
	 */
	private static function outcome_labels() {
		return array(
			'ok'              => __( 'answered', 'contextchat' ),
			'rejected'        => __( 'reply failed a check', 'contextchat' ),
			'refusal'         => __( 'declined to answer', 'contextchat' ),
			'truncated'       => __( 'reply cut off', 'contextchat' ),
			'empty'           => __( 'empty reply', 'contextchat' ),
			'model_not_found' => __( 'model not found', 'contextchat' ),
			'unavailable'     => __( 'Anthropic busy or unreachable, tried twice', 'contextchat' ),
			'auth_error'      => __( 'API key refused', 'contextchat' ),
			'spend_limit'     => __( 'Anthropic account spend limit reached', 'contextchat' ),
			'invalid_request' => __( 'request refused as invalid', 'contextchat' ),
			'cap_reached'     => __( 'daily spending cap reached', 'contextchat' ),
			'no_key'          => __( 'no API key saved', 'contextchat' ),
			'error'           => __( 'unexpected error', 'contextchat' ),
		);
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
	 * Knowledge tab: the entries the SI answers from.
	 */
	private static function knowledge_tab() {
		$entries = ContextChat_Knowledge::entries();
		$tokens  = ContextChat_Knowledge::size_tokens( $entries );
		$base    = ContextChat_Knowledge::OPTION;
		?>
		<section id="ctxc-tab-knowledge" class="ctxc-tab" data-tab="knowledge" aria-labelledby="ctxc-tablink-knowledge">
			<h2><?php esc_html_e( 'Knowledge', 'contextchat' ); ?></h2>
			<p><?php esc_html_e( 'The SI states facts about your services, process and policies only from these entries. Prices are not entered here: they come from the price table, and every total is calculated in code. Leave out anything private, such as tax numbers, bank accounts, staff names and client names.', 'contextchat' ); ?></p>
			<p class="ctxc-knowledge-status">
				<?php
				if ( ContextChat_Knowledge::using_seed() ) {
					esc_html_e( 'Using the bundled entries, taken from the Nusalexia guidelines and website on 21 November 2026. They follow plugin updates until you change them; after that, your own copy is kept.', 'contextchat' );
				} else {
					esc_html_e( 'Using your saved entries.', 'contextchat' );
				}
				echo ' ';
				printf(
					/* translators: 1: number of entries, 2: approximate number of tokens. */
					esc_html( _n( '%1$d entry, about %2$s tokens.', '%1$d entries, about %2$s tokens.', count( $entries ), 'contextchat' ) ),
					(int) count( $entries ),
					esc_html( number_format_i18n( $tokens ) )
				);
				if ( $tokens > 30000 ) {
					echo ' <strong>' . esc_html__( 'That is more than about 30,000 tokens, which makes every reply slower and more expensive. Consider shortening entries.', 'contextchat' ) . '</strong>';
				}
				?>
			</p>
			<div class="ctxc-repeater" data-repeater="knowledge">
				<div class="ctxc-rows">
					<?php
					foreach ( $entries as $i => $entry ) {
						self::knowledge_row( (string) $i, $entry );
					}
					?>
				</div>
				<template><?php self::knowledge_row( '__i__', array() ); ?></template>
				<button type="button" class="button ctxc-add"><?php esc_html_e( 'Add entry', 'contextchat' ); ?></button>
			</div>

			<h3><?php esc_html_e( 'Import and export', 'contextchat' ); ?></h3>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="ctxc-knowledge-export"><?php esc_html_e( 'Export', 'contextchat' ); ?></label></th>
					<td><textarea id="ctxc-knowledge-export" class="large-text code" rows="6" readonly><?php echo esc_textarea( wp_json_encode( array( 'entries' => $entries ), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) ); ?></textarea>
					<p class="description"><?php esc_html_e( 'The saved entries as JSON, for a backup or another site.', 'contextchat' ); ?></p></td>
				</tr>
				<tr>
					<th scope="row"><label for="ctxc-knowledge-import"><?php esc_html_e( 'Import', 'contextchat' ); ?></label></th>
					<td><textarea id="ctxc-knowledge-import" name="<?php echo esc_attr( $base ); ?>[import]" class="large-text code" rows="4"></textarea>
					<p class="description"><?php esc_html_e( 'Paste exported JSON here and save to replace all entries.', 'contextchat' ); ?></p></td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Bundled entries', 'contextchat' ); ?></th>
					<td><label><input type="checkbox" name="<?php echo esc_attr( $base ); ?>[reset]" value="1"> <?php esc_html_e( 'Replace all entries with the bundled ones when saving', 'contextchat' ); ?></label></td>
				</tr>
			</table>
		</section>
		<?php
	}

	/**
	 * Privacy tab: how long SI chats are kept, rate limits, blocked file hosts and the privacy link.
	 */
	private static function privacy_tab() {
		$conversations = admin_url( 'admin.php?page=' . self::SLUG . '-conversations' );
		?>
		<section id="ctxc-tab-privacy" class="ctxc-tab" data-tab="privacy" aria-labelledby="ctxc-tablink-privacy">
			<h2><?php esc_html_e( 'Privacy', 'contextchat' ); ?></h2>
			<?php if ( ! empty( ContextChat_Settings::get()['si_enabled'] ) && '' === ContextChat_Settings::get()['si_privacy_url'] ) : ?>
				<div class="notice notice-warning inline"><p><?php esc_html_e( 'The SI chat is on but no privacy policy address is set. Indonesian law (UU 27/2022 Pasal 21, PP 33/2026 Pasal 62) expects visitors to be able to read the full privacy information before their data is processed.', 'contextchat' ); ?></p></div>
			<?php endif; ?>
			<p><?php esc_html_e( 'SI chats are stored in your WordPress database so your team can follow up. Visitors are asked not to send ID numbers or documents; messages that contain them, or links to file-sharing services, are refused and not stored. Visitor addresses are never stored: the rate limits count a hash that changes every day.', 'contextchat' ); ?></p>
			<table class="form-table" role="presentation">
				<?php self::row_number( 'si_retention_days', __( 'Keep SI chats for (days)', 'contextchat' ), 30, 3650 ); ?>
				<tr>
					<th scope="row"></th>
					<td><p class="description">
						<?php
						printf(
							/* translators: %s: link to the Conversations screen. */
							esc_html__( 'Older chats, with their messages and estimates, are deleted every day. The privacy notice tells visitors this period. You can read, export or delete single chats on the %s screen.', 'contextchat' ),
							'<a href="' . esc_url( $conversations ) . '">' . esc_html__( 'Conversations', 'contextchat' ) . '</a>'
						);
						?>
					</p></td>
				</tr>
				<?php self::row_text( 'si_privacy_url', __( 'Privacy policy address', 'contextchat' ), __( 'Linked under the privacy notice at the top of the chat. Your policy should say that chat text is processed by Anthropic outside Indonesia, why, how long chats are kept, and how visitors can ask for a copy or deletion. Suggested text is in Settings → Privacy → Policy Guide.', 'contextchat' ), 'url' ); ?>
				<?php self::row_checkbox( 'si_consent', __( 'Ask visitors to agree first', 'contextchat' ), __( 'Shows a button before the first message and records the click with what was shown. With a notice set on the Voice tab, it reads "Agree and start"; without one, "Start chatting". Untick to start the chat straight away. Use this, with a notice, if your privacy review chooses consent as the basis for the chat.', 'contextchat' ) ); ?>
			</table>

			<h3><?php esc_html_e( 'Privacy notice', 'contextchat' ); ?></h3>
			<p>
				<?php
				esc_html_e( 'The text shown above the first message is edited on the Voice tab, under "Privacy notice before the first message". {retention} in it becomes the period set above.', 'contextchat' );
				echo ' ';
				echo '<em>' . esc_html( ContextChat_Chat_REST::notice( 0 === strpos( get_user_locale(), 'id' ) ? 'id' : 'en' ) ) . '</em>';
				?>
			</p>

			<h3><?php esc_html_e( 'Rate limits', 'contextchat' ); ?></h3>
			<p><?php esc_html_e( 'Limits per visitor. A visitor over a limit is offered WhatsApp or email instead, and nothing is sent to Anthropic.', 'contextchat' ); ?></p>
			<table class="form-table" role="presentation">
				<?php
				self::row_number( 'si_limit_minute', __( 'Messages per minute', 'contextchat' ), 1, 60 );
				self::row_number( 'si_limit_starts', __( 'New chats per hour', 'contextchat' ), 1, 100 );
				self::row_number( 'si_limit_day', __( 'Messages per day', 'contextchat' ), 1, 1000 );
				self::row_number( 'si_limit_conversation', __( 'Messages per chat', 'contextchat' ), 4, 200 );
				?>
			</table>

			<h3><?php esc_html_e( 'File-sharing services', 'contextchat' ); ?></h3>
			<table class="form-table" role="presentation">
				<?php self::row_textarea( 'si_file_hosts', __( 'Refused links', 'contextchat' ), __( 'One host per line. A message linking to one of these is refused, and the visitor is asked to send files by WhatsApp or email. Leave empty for the built-in list.', 'contextchat' ) ); ?>
			</table>
		</section>
		<?php
	}

	/**
	 * Prices tab: the price table the SI quotes from, and the Apostille member list.
	 */
	private static function prices_tab() {
		$t     = ContextChat_Prices::table();
		$list  = ContextChat_Prices::apostille();
		$base  = ContextChat_Prices::OPTION;
		$abase = ContextChat_Prices::APOSTILLE;
		$now   = time();
		$age   = ContextChat_Prices::age_days( isset( $t['fetched_at'] ) ? $t['fetched_at'] : '', $now );
		$a_age = ContextChat_Prices::age_days( isset( $list['fetched_at'] ) ? $list['fetched_at'] : '', $now );
		$langs = ContextChat_Price_Engine::LANG_NAMES[ 0 === strpos( get_user_locale(), 'id' ) ? 'id' : 'en' ];
		$rows  = array();
		foreach ( isset( $t['rates'] ) ? $t['rates'] : array() as $pair => $r ) {
			list( $src, $tgt ) = array_pad( explode( '-', (string) $pair ), 2, '' );
			$rows[]            = array(
				'source'  => $src,
				'target'  => $tgt,
				'regular' => isset( $r['regular'] ) ? $r['regular'] : null,
				'sworn'   => isset( $r['sworn'] ) ? $r['sworn'] : null,
			);
		}
		$tiers = isset( $t['volume_discounts'] ) ? array_values( $t['volume_discounts'] ) : array();
		usort(
			$tiers,
			function ( $a, $b ) {
				return $a['min_documents'] - $b['min_documents'];
			}
		);
		$tier1 = isset( $tiers[0] ) ? $tiers[0] : array( 'min_documents' => '', 'percent' => '' );
		$tier2 = isset( $tiers[1] ) ? $tiers[1] : array( 'min_documents' => '', 'percent' => '' );
		$num   = function ( $name, $value, $label, $min = 0, $suffix = '' ) use ( $base ) {
			$id = 'ctxc-pr-' . $name;
			?>
			<tr>
				<th scope="row"><label for="<?php echo esc_attr( $id ); ?>"><?php echo esc_html( $label ); ?></label></th>
				<td><input type="number" id="<?php echo esc_attr( $id ); ?>" name="<?php echo esc_attr( $base . '[' . $name . ']' ); ?>" value="<?php echo esc_attr( (string) $value ); ?>" min="<?php echo (int) $min; ?>" step="1" class="regular-text"> <?php echo esc_html( $suffix ); ?></td>
			</tr>
			<?php
		};
		?>
		<section id="ctxc-tab-prices" class="ctxc-tab" data-tab="prices" aria-labelledby="ctxc-tablink-prices">
			<h2><?php esc_html_e( 'Prices', 'contextchat' ); ?></h2>
			<p><?php esc_html_e( 'The SI never works out a price itself. Every estimate is calculated in code from this table, in whole rupiah, and shown to the visitor as an estimate that your team confirms. Keep it the same as your public price list.', 'contextchat' ); ?></p>
			<p class="ctxc-prices-status">
				<?php
				if ( ContextChat_Prices::using_seed() ) {
					/* translators: %s: date. */
					printf( esc_html__( 'Using the bundled table, copied from the Nusalexia price list on %s. It follows plugin updates until you change it.', 'contextchat' ), esc_html( (string) $t['fetched_at'] ) );
				} else {
					/* translators: %s: date. */
					printf( esc_html__( 'Using your saved table, last changed on %s.', 'contextchat' ), esc_html( (string) $t['fetched_at'] ) );
				}
				if ( null !== $age && $age > ContextChat_Prices::STALE_DAYS ) {
					/* translators: %d: number of days. */
					echo ' <strong class="ctxc-stale">' . esc_html( sprintf( __( 'These prices were last checked %d days ago. Compare them with your price list and save to confirm.', 'contextchat' ), $age ) ) . '</strong>';
				}
				?>
			</p>
			<input type="hidden" name="<?php echo esc_attr( $base ); ?>[form]" value="1">

			<h3><?php esc_html_e( 'Rates per translated page', 'contextchat' ); ?></h3>
			<p class="description"><?php esc_html_e( 'Rupiah per translated A4 page. Leave a package empty when it is not offered for that pair; the SI then hands the visitor to your team.', 'contextchat' ); ?></p>
			<div class="ctxc-repeater" data-repeater="prices">
				<div class="ctxc-rows">
					<?php
					foreach ( $rows as $i => $row ) {
						self::price_row( (string) $i, $row, $langs );
					}
					?>
				</div>
				<template><?php self::price_row( '__i__', array(), $langs ); ?></template>
				<button type="button" class="button ctxc-add"><?php esc_html_e( 'Add language pair', 'contextchat' ); ?></button>
			</div>

			<h3><?php esc_html_e( 'Fees and rules', 'contextchat' ); ?></h3>
			<table class="form-table" role="presentation">
				<?php
				$num( 'legal_ministry', $t['legalisation']['ministry'], __( 'Ministry legalisation, per document', 'contextchat' ), 0, 'Rp' );
				$num( 'legal_embassy', $t['legalisation']['embassy'], __( 'Embassy legalisation, per document', 'contextchat' ), 0, 'Rp' );
				$num( 'legal_apostille', $t['legalisation']['apostille'], __( 'Apostille, per document', 'contextchat' ), 0, 'Rp' );
				$num( 'terminology', $t['terminology_per_hour'], __( 'Terminology work, per hour', 'contextchat' ), 0, 'Rp' );
				$num( 'express_next_day', (int) $t['express_percent']['next_day'] - 100, __( 'Next-day surcharge', 'contextchat' ), 0, '%' );
				$num( 'express_same_day', (int) $t['express_percent']['same_day'] - 100, __( 'Same-day surcharge', 'contextchat' ), 0, '%' );
				$num( 'discount1_documents', $tier1['min_documents'], __( 'First volume discount from (documents)', 'contextchat' ), 2 );
				$num( 'discount1_percent', $tier1['percent'], __( 'First volume discount', 'contextchat' ), 0, '%' );
				$num( 'discount2_documents', $tier2['min_documents'], __( 'Second volume discount from (documents)', 'contextchat' ), 2 );
				$num( 'discount2_percent', $tier2['percent'], __( 'Second volume discount', 'contextchat' ), 0, '%' );
				$num( 'deposit_min', $t['deposit']['min_total'], __( 'Deposit asked from orders of', 'contextchat' ), 0, 'Rp' );
				$num( 'deposit_percent', $t['deposit']['percent'], __( 'Deposit', 'contextchat' ), 0, '%' );
				$num( 'min_pages', $t['min_pages'], __( 'Minimum pages per document', 'contextchat' ), 1 );
				$num( 'revisions', $t['revisions']['count'], __( 'Free revisions', 'contextchat' ) );
				$num( 'revision_days', $t['revisions']['days'], __( 'Revision period (days)', 'contextchat' ) );
				$num( 'valid_days', $t['valid_days'], __( 'Estimates valid for (days)', 'contextchat' ), 1 );
				?>
				<tr>
					<th scope="row"><label for="ctxc-pr-source_url"><?php esc_html_e( 'Public price list', 'contextchat' ); ?></label></th>
					<td><input type="url" id="ctxc-pr-source_url" name="<?php echo esc_attr( $base ); ?>[source_url]" value="<?php echo esc_attr( (string) $t['source_url'] ); ?>" class="regular-text">
					<p class="description"><?php esc_html_e( 'Where these prices are published, kept with the table so your team can compare them.', 'contextchat' ); ?></p></td>
				</tr>
			</table>

			<h3><?php esc_html_e( 'Import and export', 'contextchat' ); ?></h3>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="ctxc-prices-export"><?php esc_html_e( 'Export', 'contextchat' ); ?></label></th>
					<td><textarea id="ctxc-prices-export" class="large-text code" rows="6" readonly><?php echo esc_textarea( wp_json_encode( $t, JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) ); ?></textarea></td>
				</tr>
				<tr>
					<th scope="row"><label for="ctxc-prices-import"><?php esc_html_e( 'Import', 'contextchat' ); ?></label></th>
					<td><textarea id="ctxc-prices-import" name="<?php echo esc_attr( $base ); ?>[import]" class="large-text code" rows="4"></textarea>
					<p class="description"><?php esc_html_e( 'Paste an exported table here and save to replace the whole table, including the fields above.', 'contextchat' ); ?></p></td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Bundled table', 'contextchat' ); ?></th>
					<td><label><input type="checkbox" name="<?php echo esc_attr( $base ); ?>[reset]" value="1"> <?php esc_html_e( 'Go back to the bundled table when saving', 'contextchat' ); ?></label></td>
				</tr>
			</table>

			<h3><?php esc_html_e( 'Apostille countries', 'contextchat' ); ?></h3>
			<p><?php esc_html_e( 'A document for one of these countries gets an Apostille; for any other country the SI quotes ministry and embassy legalisation. One country per line: its two-letter code, the date the Apostille Convention entered into force for it, and its name.', 'contextchat' ); ?></p>
			<p class="ctxc-apostille-status">
				<?php
				printf(
					/* translators: 1: number of countries, 2: date, 3: source address. */
					esc_html__( '%1$d countries, checked on %2$s against %3$s.', 'contextchat' ),
					(int) count( $list['members'] ),
					esc_html( (string) $list['fetched_at'] ),
					'<a href="' . esc_url( (string) $list['source_url'] ) . '" target="_blank" rel="noopener noreferrer">' . esc_html__( 'the HCCH status table', 'contextchat' ) . '</a>'
				);
				if ( null !== $a_age && $a_age > ContextChat_Prices::APOSTILLE_STALE_DAYS ) {
					echo ' <strong class="ctxc-stale">' . esc_html__( 'More than a year has passed. Check the HCCH status table for new members, and for any objection to Indonesia\'s accession, then save.', 'contextchat' ) . '</strong>';
				}
				?>
			</p>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="ctxc-apostille-lines"><?php esc_html_e( 'Members', 'contextchat' ); ?></label></th>
					<td><textarea id="ctxc-apostille-lines" name="<?php echo esc_attr( $abase ); ?>[lines]" class="large-text code" rows="10"><?php echo esc_textarea( ContextChat_Prices::apostille_lines( $list ) ); ?></textarea>
					<p class="description"><?php esc_html_e( 'Hong Kong and Macao are covered through China (CN). A member that has objected to Indonesia\'s accession must not be listed.', 'contextchat' ); ?></p></td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Bundled list', 'contextchat' ); ?></th>
					<td><label><input type="checkbox" name="<?php echo esc_attr( $abase ); ?>[reset]" value="1"> <?php esc_html_e( 'Go back to the bundled list when saving', 'contextchat' ); ?></label></td>
				</tr>
			</table>
		</section>
		<?php
	}

	/**
	 * One language-pair row of the price table.
	 *
	 * @param string $i     Index.
	 * @param array  $row   source, target, regular, sworn.
	 * @param array  $langs Language names by code.
	 */
	private static function price_row( $i, array $row, array $langs ) {
		$row  = array_merge(
			array(
				'source'  => 'id',
				'target'  => 'en',
				'regular' => null,
				'sworn'   => null,
			),
			$row
		);
		$base = ContextChat_Prices::OPTION . '[rows][' . $i . ']';
		$uid  = 'ctxc-pr-row-' . $i;
		?>
		<div class="ctxc-row ctxc-price-row">
			<div class="ctxc-fields">
				<?php foreach ( array( 'source' => __( 'From', 'contextchat' ), 'target' => __( 'Into', 'contextchat' ) ) as $key => $label ) : ?>
					<label for="<?php echo esc_attr( $uid . '-' . $key ); ?>"><?php echo esc_html( $label ); ?>
						<select id="<?php echo esc_attr( $uid . '-' . $key ); ?>" name="<?php echo esc_attr( $base . '[' . $key . ']' ); ?>">
							<?php foreach ( $langs as $code => $name ) : ?>
								<option value="<?php echo esc_attr( $code ); ?>" <?php selected( $row[ $key ], $code ); ?>><?php echo esc_html( $name ); ?></option>
							<?php endforeach; ?>
						</select>
					</label>
				<?php endforeach; ?>
				<label for="<?php echo esc_attr( $uid ); ?>-regular"><?php esc_html_e( 'Regular (Rp)', 'contextchat' ); ?>
					<input type="number" min="0" step="1" id="<?php echo esc_attr( $uid ); ?>-regular" name="<?php echo esc_attr( $base ); ?>[regular]" value="<?php echo esc_attr( null === $row['regular'] ? '' : (string) $row['regular'] ); ?>">
				</label>
				<label for="<?php echo esc_attr( $uid ); ?>-sworn"><?php esc_html_e( 'Sworn (Rp)', 'contextchat' ); ?>
					<input type="number" min="0" step="1" id="<?php echo esc_attr( $uid ); ?>-sworn" name="<?php echo esc_attr( $base ); ?>[sworn]" value="<?php echo esc_attr( null === $row['sworn'] ? '' : (string) $row['sworn'] ); ?>">
				</label>
			</div>
			<button type="button" class="button-link ctxc-remove" aria-label="<?php esc_attr_e( 'Remove language pair', 'contextchat' ); ?>"><span class="dashicons dashicons-trash"></span></button>
		</div>
		<?php
	}

	/**
	 * One knowledge entry row.
	 *
	 * @param string $i     Index.
	 * @param array  $entry Entry.
	 */
	private static function knowledge_row( $i, array $entry ) {
		$entry = array_merge(
			array(
				'id'         => '',
				'title'      => '',
				'lang'       => 'id',
				'body'       => '',
				'tags'       => array(),
				'source_url' => '',
				'updated'    => '',
			),
			$entry
		);
		$base  = ContextChat_Knowledge::OPTION . '[rows][' . $i . ']';
		$uid   = 'ctxc-kn-' . $i;
		?>
		<div class="ctxc-row ctxc-knowledge-row">
			<input type="hidden" name="<?php echo esc_attr( $base ); ?>[id]" value="<?php echo esc_attr( $entry['id'] ); ?>">
			<input type="hidden" name="<?php echo esc_attr( $base ); ?>[updated]" value="<?php echo esc_attr( $entry['updated'] ); ?>">
			<div class="ctxc-fields">
				<label for="<?php echo esc_attr( $uid ); ?>-title"><?php esc_html_e( 'Title', 'contextchat' ); ?>
					<input type="text" id="<?php echo esc_attr( $uid ); ?>-title" name="<?php echo esc_attr( $base ); ?>[title]" value="<?php echo esc_attr( $entry['title'] ); ?>">
				</label>
				<label for="<?php echo esc_attr( $uid ); ?>-lang"><?php esc_html_e( 'Language', 'contextchat' ); ?>
					<select id="<?php echo esc_attr( $uid ); ?>-lang" name="<?php echo esc_attr( $base ); ?>[lang]">
						<option value="id" <?php selected( $entry['lang'], 'id' ); ?>><?php esc_html_e( 'Indonesian', 'contextchat' ); ?></option>
						<option value="en" <?php selected( $entry['lang'], 'en' ); ?>><?php esc_html_e( 'English', 'contextchat' ); ?></option>
					</select>
				</label>
				<label for="<?php echo esc_attr( $uid ); ?>-tags"><?php esc_html_e( 'Tags', 'contextchat' ); ?>
					<input type="text" id="<?php echo esc_attr( $uid ); ?>-tags" name="<?php echo esc_attr( $base ); ?>[tags]" value="<?php echo esc_attr( implode( ', ', $entry['tags'] ) ); ?>">
				</label>
				<label for="<?php echo esc_attr( $uid ); ?>-source"><?php esc_html_e( 'Source address', 'contextchat' ); ?>
					<input type="url" id="<?php echo esc_attr( $uid ); ?>-source" name="<?php echo esc_attr( $base ); ?>[source_url]" value="<?php echo esc_attr( $entry['source_url'] ); ?>">
				</label>
				<label class="ctxc-wide" for="<?php echo esc_attr( $uid ); ?>-body"><?php esc_html_e( 'Text', 'contextchat' ); ?>
					<textarea id="<?php echo esc_attr( $uid ); ?>-body" name="<?php echo esc_attr( $base ); ?>[body]" rows="4" maxlength="<?php echo (int) ContextChat_Knowledge::MAX_BODY; ?>"><?php echo esc_textarea( $entry['body'] ); ?></textarea>
				</label>
			</div>
			<button type="button" class="button-link ctxc-remove" aria-label="<?php esc_attr_e( 'Remove entry', 'contextchat' ); ?>"><span class="dashicons dashicons-trash"></span></button>
		</div>
		<?php
	}

	/**
	 * Voice tab: voice guide, examples, fixed replies, banned words and staff names.
	 */
	private static function voice_tab() {
		$v    = ContextChat_Voice::get();
		$base = ContextChat_Voice::OPTION;
		?>
		<section id="ctxc-tab-voice" class="ctxc-tab" data-tab="voice" aria-labelledby="ctxc-tablink-voice">
			<h2><?php esc_html_e( 'Voice', 'contextchat' ); ?></h2>
			<p><?php esc_html_e( 'How the SI writes. Empty fields use the bundled defaults.', 'contextchat' ); ?></p>
			<input type="hidden" name="<?php echo esc_attr( $base ); ?>[form]" value="1">
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><label for="ctxc-voice-guide-id"><?php esc_html_e( 'Voice guide (Indonesian)', 'contextchat' ); ?></label></th>
					<td><textarea id="ctxc-voice-guide-id" name="<?php echo esc_attr( $base ); ?>[guide][id]" class="large-text" rows="10"><?php echo esc_textarea( $v['guide']['id'] ); ?></textarea></td>
				</tr>
				<tr>
					<th scope="row"><label for="ctxc-voice-guide-en"><?php esc_html_e( 'Voice guide (English)', 'contextchat' ); ?></label></th>
					<td><textarea id="ctxc-voice-guide-en" name="<?php echo esc_attr( $base ); ?>[guide][en]" class="large-text" rows="4"><?php echo esc_textarea( $v['guide']['en'] ); ?></textarea></td>
				</tr>
				<tr>
					<th scope="row"><label for="ctxc-voice-names"><?php esc_html_e( 'Names never to mention', 'contextchat' ); ?></label></th>
					<td><textarea id="ctxc-voice-names" name="<?php echo esc_attr( $base ); ?>[names]" class="large-text" rows="3"><?php echo esc_textarea( implode( "\n", $v['names'] ) ); ?></textarea>
					<p class="description"><?php esc_html_e( 'One per line: the names of staff and anyone else the SI must never name. A reply that contains one is rejected. The list starts empty so that no name is published in the plugin itself.', 'contextchat' ); ?></p></td>
				</tr>
				<tr>
					<th scope="row"><label for="ctxc-voice-banned"><?php esc_html_e( 'Extra banned words', 'contextchat' ); ?></label></th>
					<td><textarea id="ctxc-voice-banned" name="<?php echo esc_attr( $base ); ?>[banned_words]" class="large-text" rows="3"><?php echo esc_textarea( implode( "\n", $v['banned_words'] ) ); ?></textarea>
					<p class="description"><?php esc_html_e( 'One per line, on top of the built-in list ("AI", "kecerdasan buatan", "gue", "lo", "gak", "nggak" and emoji).', 'contextchat' ); ?></p></td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Bundled voice', 'contextchat' ); ?></th>
					<td><label><input type="checkbox" name="<?php echo esc_attr( $base ); ?>[reset]" value="1"> <?php esc_html_e( 'Go back to the bundled voice when saving', 'contextchat' ); ?></label></td>
				</tr>
			</table>

			<h3><?php esc_html_e( 'Example replies', 'contextchat' ); ?></h3>
			<p><?php esc_html_e( 'The SI copies the style of these replies. The first one is the reference reply.', 'contextchat' ); ?></p>
			<div class="ctxc-repeater" data-repeater="examples">
				<div class="ctxc-rows">
					<?php
					foreach ( $v['examples'] as $i => $example ) {
						self::example_row( (string) $i, $example );
					}
					?>
				</div>
				<template><?php self::example_row( '__i__', array() ); ?></template>
				<button type="button" class="button ctxc-add"><?php esc_html_e( 'Add example', 'contextchat' ); ?></button>
			</div>

			<h3><?php esc_html_e( 'Fixed replies', 'contextchat' ); ?></h3>
			<p><?php esc_html_e( 'Sent without asking the model: greetings, blocked messages, limits and errors.', 'contextchat' ); ?></p>
			<table class="widefat striped ctxc-templates-table">
				<thead><tr><th><?php esc_html_e( 'When', 'contextchat' ); ?></th><th><?php esc_html_e( 'Indonesian', 'contextchat' ); ?></th><th><?php esc_html_e( 'English', 'contextchat' ); ?></th></tr></thead>
				<tbody>
					<?php foreach ( $v['templates'] as $key => $texts ) : ?>
						<tr>
							<th scope="row"><?php echo esc_html( self::template_label( $key ) ); ?></th>
							<?php foreach ( array( 'id', 'en' ) as $lang ) : ?>
								<td><textarea class="large-text" rows="3" aria-label="<?php echo esc_attr( self::template_label( $key ) . ' (' . $lang . ')' ); ?>" name="<?php echo esc_attr( $base . '[templates][' . $key . '][' . $lang . ']' ); ?>"><?php echo esc_textarea( $texts[ $lang ] ); ?></textarea></td>
							<?php endforeach; ?>
						</tr>
					<?php endforeach; ?>
				</tbody>
			</table>
		</section>
		<?php
	}

	/**
	 * One example row.
	 *
	 * @param string $i       Index.
	 * @param array  $example Example.
	 */
	private static function example_row( $i, array $example ) {
		$example = array_merge(
			array(
				'situation' => '',
				'lang'      => 'id',
				'reply'     => '',
			),
			$example
		);
		$base    = ContextChat_Voice::OPTION . '[examples][' . $i . ']';
		$uid     = 'ctxc-ex-' . $i;
		?>
		<div class="ctxc-row ctxc-example-row">
			<div class="ctxc-fields">
				<label for="<?php echo esc_attr( $uid ); ?>-situation"><?php esc_html_e( 'Situation', 'contextchat' ); ?>
					<input type="text" id="<?php echo esc_attr( $uid ); ?>-situation" name="<?php echo esc_attr( $base ); ?>[situation]" value="<?php echo esc_attr( $example['situation'] ); ?>">
				</label>
				<label for="<?php echo esc_attr( $uid ); ?>-lang"><?php esc_html_e( 'Language', 'contextchat' ); ?>
					<select id="<?php echo esc_attr( $uid ); ?>-lang" name="<?php echo esc_attr( $base ); ?>[lang]">
						<option value="id" <?php selected( $example['lang'], 'id' ); ?>><?php esc_html_e( 'Indonesian', 'contextchat' ); ?></option>
						<option value="en" <?php selected( $example['lang'], 'en' ); ?>><?php esc_html_e( 'English', 'contextchat' ); ?></option>
					</select>
				</label>
				<label class="ctxc-wide" for="<?php echo esc_attr( $uid ); ?>-reply"><?php esc_html_e( 'Reply', 'contextchat' ); ?>
					<textarea id="<?php echo esc_attr( $uid ); ?>-reply" name="<?php echo esc_attr( $base ); ?>[reply]" rows="3"><?php echo esc_textarea( $example['reply'] ); ?></textarea>
				</label>
			</div>
			<button type="button" class="button-link ctxc-remove" aria-label="<?php esc_attr_e( 'Remove example', 'contextchat' ); ?>"><span class="dashicons dashicons-trash"></span></button>
		</div>
		<?php
	}

	/**
	 * Readable names of the fixed replies.
	 *
	 * @param string $key Template key.
	 * @return string
	 */
	private static function template_label( $key ) {
		$labels = array(
			'greeting'           => __( 'Greeting', 'contextchat' ),
			'notice'             => __( 'Privacy notice before the first message', 'contextchat' ),
			'busy'               => __( 'The model is busy or failed', 'contextchat' ),
			'rate_limited'       => __( 'Too many messages', 'contextchat' ),
			'upload'             => __( 'Tried to send a file or file link', 'contextchat' ),
			'pii'                => __( 'Sent an ID or card number', 'contextchat' ),
			'too_long'           => __( 'Message too long', 'contextchat' ),
			'markup'             => __( 'Message could not be read', 'contextchat' ),
			'unknown'            => __( 'No information on a question', 'contextchat' ),
			'names'              => __( 'Asked for a staff name', 'contextchat' ),
			'instructions'       => __( 'Asked for the SI\'s instructions', 'contextchat' ),
			'conversation_limit' => __( 'Conversation too long', 'contextchat' ),
			'cap_reached'        => __( 'Daily spending cap reached', 'contextchat' ),
			'fallback'           => __( 'A reply failed its checks twice', 'contextchat' ),
			'handoff_hours'      => __( 'Handoff outside opening hours', 'contextchat' ),
			'idle'               => __( 'Offer after 3 minutes of silence', 'contextchat' ),
		);
		return isset( $labels[ $key ] ) ? $labels[ $key ] : $key;
	}
}
