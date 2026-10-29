<?php
/**
 * Appearance → Corbelwise: getting started, theme options and a one-click home page.
 *
 * @package Corbelwise
 */

defined( 'ABSPATH' ) || exit;

add_action( 'admin_menu', 'corbelwise_admin_menu' );
add_action( 'admin_init', 'corbelwise_register_settings' );
add_action( 'admin_post_corbelwise_create_home', 'corbelwise_handle_create_home' );
add_action( 'admin_notices', 'corbelwise_activation_notice' );
add_action( 'after_switch_theme', 'corbelwise_flag_activation' );

/**
 * Add the Appearance → Corbelwise page.
 */
function corbelwise_admin_menu() {
	add_theme_page(
		__( 'Corbelwise', 'corbelwise' ),
		__( 'Corbelwise', 'corbelwise' ),
		'edit_theme_options',
		'corbelwise',
		'corbelwise_render_admin_page'
	);
}

/**
 * Register the theme options with the Settings API.
 */
function corbelwise_register_settings() {
	register_setting(
		'corbelwise_options_group',
		'corbelwise_options',
		array(
			'type'              => 'array',
			'sanitize_callback' => 'corbelwise_sanitize_options',
			'default'           => corbelwise_option_defaults(),
		)
	);
}

/**
 * Remember that the theme was just activated, to show a one-time pointer to the Corbelwise page.
 */
function corbelwise_flag_activation() {
	set_transient( 'corbelwise_just_activated', 1, DAY_IN_SECONDS );
}

/**
 * One-time notice after activation.
 */
function corbelwise_activation_notice() {
	if ( ! current_user_can( 'edit_theme_options' ) || ! get_transient( 'corbelwise_just_activated' ) ) {
		return;
	}
	$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
	if ( $screen && 'appearance_page_corbelwise' === $screen->id ) {
		delete_transient( 'corbelwise_just_activated' );
		return;
	}
	printf(
		'<div class="notice notice-success is-dismissible"><p>%1$s <a href="%2$s">%3$s</a></p></div>',
		esc_html__( 'Corbelwise is active.', 'corbelwise' ),
		esc_url( admin_url( 'themes.php?page=corbelwise' ) ),
		esc_html__( 'Open the getting-started page', 'corbelwise' )
	);
}

/**
 * The page the "Create a home page" button made, if it still exists.
 *
 * @return WP_Post|null
 */
function corbelwise_created_home_page() {
	$page_id = (int) get_option( 'corbelwise_home_page_id', 0 );
	if ( ! $page_id ) {
		return null;
	}
	$page = get_post( $page_id );
	return ( $page && 'page' === $page->post_type && 'trash' !== $page->post_status ) ? $page : null;
}

/**
 * Starter pages: slug => title, full-page pattern and template. The header menu and the section
 * buttons link to these addresses.
 *
 * @return array<string, array{0:string,1:string,2:string}>
 */
function corbelwise_starter_pages() {
	return array(
		'home'     => array( __( 'Home', 'corbelwise' ), 'page-home', 'page-no-title' ),
		'about'    => array( __( 'About', 'corbelwise' ), 'page-about', 'page-no-title' ),
		'services' => array( __( 'Services', 'corbelwise' ), 'page-services', 'page-no-title' ),
		'pricing'  => array( __( 'Pricing', 'corbelwise' ), 'page-pricing', 'page-no-title' ),
		'contact'  => array( __( 'Contact', 'corbelwise' ), 'page-contact', 'page-no-title' ),
	);
}

/**
 * Create the starter pages that do not exist yet and, if asked, show Home as the front page.
 * Existing pages with the same address are never changed.
 */
function corbelwise_handle_create_home() {
	if ( ! current_user_can( 'edit_theme_options' ) || ! current_user_can( 'publish_pages' ) ) {
		wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'corbelwise' ), 403 );
	}
	check_admin_referer( 'corbelwise_create_home' );

	foreach ( corbelwise_starter_pages() as $slug => $page ) {
		if ( 'home' === $slug ? corbelwise_created_home_page() : get_page_by_path( $slug ) ) {
			continue;
		}
		$page_id = wp_insert_post(
			array(
				'post_type'    => 'page',
				'post_status'  => 'publish',
				'post_title'   => $page[0],
				'post_name'    => 'home' === $slug ? '' : $slug,
				'post_content' => corbelwise_pattern_markup( $page[1] ),
				'meta_input'   => array( '_wp_page_template' => $page[2] ),
			),
			true
		);
		if ( is_wp_error( $page_id ) ) {
			wp_die( esc_html( $page_id->get_error_message() ) );
		}
		if ( 'home' === $slug ) {
			update_option( 'corbelwise_home_page_id', (int) $page_id, false );
		}
	}

	$home = corbelwise_created_home_page();
	if ( $home && ! empty( $_POST['set_front_page'] ) && current_user_can( 'manage_options' ) ) {
		update_option( 'show_on_front', 'page' );
		update_option( 'page_on_front', (int) $home->ID );
	}

	wp_safe_redirect( add_query_arg( 'corbelwise-home', 'created', admin_url( 'themes.php?page=corbelwise' ) ) );
	exit;
}

/**
 * Render Appearance → Corbelwise.
 */
function corbelwise_render_admin_page() {
	if ( ! current_user_can( 'edit_theme_options' ) ) {
		return;
	}
	$home        = corbelwise_created_home_page();
	$is_front    = $home && 'page' === get_option( 'show_on_front' ) && (int) get_option( 'page_on_front' ) === (int) $home->ID;
	$toolkit_on  = defined( 'CWTK_VERSION' );
	$scheme      = corbelwise_option( 'color_scheme' );
	$site_editor = admin_url( 'site-editor.php' );
	?>
	<div class="wrap corbelwise-admin">
		<h1><?php esc_html_e( 'Corbelwise', 'corbelwise' ); ?></h1>
		<p class="about-description"><?php esc_html_e( 'Everything you see on your site is edited visually: open the Site Editor to change colours, fonts, the header, the footer and every template.', 'corbelwise' ); ?></p>

		<?php if ( isset( $_GET['corbelwise-home'] ) && $home ) : // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- display only. ?>
			<div class="notice notice-success"><p>
				<?php esc_html_e( 'Your pages are ready.', 'corbelwise' ); ?>
				<a href="<?php echo esc_url( get_edit_post_link( $home->ID ) ); ?>"><?php esc_html_e( 'Edit the home page', 'corbelwise' ); ?></a> ·
				<a href="<?php echo esc_url( admin_url( 'edit.php?post_type=page' ) ); ?>"><?php esc_html_e( 'All pages', 'corbelwise' ); ?></a>
			</p></div>
		<?php endif; ?>

		<h2><?php esc_html_e( '1. Choose a style', 'corbelwise' ); ?></h2>
		<p><?php esc_html_e( 'Six ready-made styles suit different kinds of business: Ink (default), Ocean, Sage, Ember, Noir and Mono. Each one sets the colours, light and dark, and the fonts.', 'corbelwise' ); ?></p>
		<p><a class="button" href="<?php echo esc_url( add_query_arg( 'path', '/wp_global_styles', $site_editor ) ); ?>"><?php esc_html_e( 'Browse styles', 'corbelwise' ); ?></a></p>

		<h2><?php esc_html_e( '2. Create your starter pages', 'corbelwise' ); ?></h2>
		<?php if ( $home ) : ?>
			<p>
				<?php
				echo $is_front
					? esc_html__( 'Your Corbelwise home page exists and is your front page.', 'corbelwise' )
					: esc_html__( 'Your Corbelwise home page exists but is not your front page.', 'corbelwise' );
				?>
				<a href="<?php echo esc_url( get_edit_post_link( $home->ID ) ); ?>"><?php esc_html_e( 'Edit it', 'corbelwise' ); ?></a>
			</p>
		<?php else : ?>
			<p><?php esc_html_e( 'Create five published pages, Home, About, Services, Pricing and Contact, laid out and ready for your own words. The header menu already links to them. Pages you already have at these addresses are left alone.', 'corbelwise' ); ?></p>
		<?php endif; ?>
		<?php if ( ! $is_front ) : ?>
			<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
				<input type="hidden" name="action" value="corbelwise_create_home">
				<?php wp_nonce_field( 'corbelwise_create_home' ); ?>
				<?php if ( current_user_can( 'manage_options' ) ) : ?>
					<p><label><input type="checkbox" name="set_front_page" value="1" checked> <?php esc_html_e( 'Show it as my front page (Settings → Reading)', 'corbelwise' ); ?></label></p>
				<?php endif; ?>
				<?php submit_button( $home ? __( 'Use it as my front page', 'corbelwise' ) : __( 'Create my pages', 'corbelwise' ), 'primary', 'submit', false ); ?>
			</form>
		<?php endif; ?>
		<p class="description"><?php esc_html_e( 'You can also start any new page from a full-page layout: add a page, then pick a layout from "Choose a pattern".', 'corbelwise' ); ?></p>

		<h2><?php esc_html_e( '3. Header, footer and menu', 'corbelwise' ); ?></h2>
		<p><?php esc_html_e( 'Add your logo, menu links and contact details in the header and footer.', 'corbelwise' ); ?></p>
		<p>
			<a class="button" href="<?php echo esc_url( add_query_arg( 'path', '/wp_template_part/all', $site_editor ) ); ?>"><?php esc_html_e( 'Edit header and footer', 'corbelwise' ); ?></a>
			<a class="button" href="<?php echo esc_url( add_query_arg( 'path', '/navigation', $site_editor ) ); ?>"><?php esc_html_e( 'Edit menus', 'corbelwise' ); ?></a>
		</p>

		<h2><?php esc_html_e( '4. Theme options', 'corbelwise' ); ?></h2>
		<form method="post" action="options.php">
			<?php settings_fields( 'corbelwise_options_group' ); ?>
			<table class="form-table" role="presentation">
				<tr>
					<th scope="row"><?php esc_html_e( 'Dark mode', 'corbelwise' ); ?></th>
					<td><fieldset>
						<legend class="screen-reader-text"><?php esc_html_e( 'Dark mode', 'corbelwise' ); ?></legend>
						<label><input type="radio" name="corbelwise_options[color_scheme]" value="toggle" <?php checked( $scheme, 'toggle' ); ?>> <?php esc_html_e( 'Follow the visitor\'s device and show a light/dark switch in the header', 'corbelwise' ); ?></label><br>
						<label><input type="radio" name="corbelwise_options[color_scheme]" value="system" <?php checked( $scheme, 'system' ); ?>> <?php esc_html_e( 'Follow the visitor\'s device, no switch', 'corbelwise' ); ?></label><br>
						<label><input type="radio" name="corbelwise_options[color_scheme]" value="light" <?php checked( $scheme, 'light' ); ?>> <?php esc_html_e( 'Always use the light colours', 'corbelwise' ); ?></label>
					</fieldset></td>
				</tr>
				<tr>
					<th scope="row"><?php esc_html_e( 'Header', 'corbelwise' ); ?></th>
					<td><label><input type="checkbox" name="corbelwise_options[sticky_header]" value="1" <?php checked( (bool) corbelwise_option( 'sticky_header' ) ); ?>> <?php esc_html_e( 'Keep the header at the top of the screen while scrolling', 'corbelwise' ); ?></label></td>
				</tr>
			</table>
			<?php submit_button(); ?>
		</form>

		<h2><?php esc_html_e( '5. Corbelwise Toolkit (optional)', 'corbelwise' ); ?></h2>
		<?php if ( $toolkit_on ) : ?>
			<p><?php esc_html_e( 'The Corbelwise Toolkit plugin is active.', 'corbelwise' ); ?> <a href="<?php echo esc_url( admin_url( 'admin.php?page=cwtk' ) ); ?>"><?php esc_html_e( 'Open its settings', 'corbelwise' ); ?></a></p>
		<?php else : ?>
			<p><?php esc_html_e( 'The free Corbelwise Toolkit plugin adds switchable modules: speed and security settings, SEO and structured data, your business details, an announcement bar and an optional AI writing assistant and visitor chat. Upload corbelwise-toolkit.zip from your download under Plugins → Add New Plugin → Upload Plugin.', 'corbelwise' ); ?></p>
			<?php if ( current_user_can( 'install_plugins' ) ) : ?>
				<p><a class="button" href="<?php echo esc_url( admin_url( 'plugin-install.php?tab=upload' ) ); ?>"><?php esc_html_e( 'Upload a plugin', 'corbelwise' ); ?></a></p>
			<?php endif; ?>
		<?php endif; ?>
	</div>
	<?php
}
