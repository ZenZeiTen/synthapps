<?php
/**
 * The Corbelwise settings screen: a Modules tab plus one tab per module that is switched on.
 *
 * @package Corbelwise\Toolkit
 */

namespace Corbelwise\Toolkit;

defined( 'ABSPATH' ) || exit;

/**
 * Settings screen.
 */
class Admin {

	const PAGE = 'cwtk';

	/**
	 * Plugin.
	 *
	 * @var Plugin
	 */
	private $plugin;

	/**
	 * Constructor.
	 *
	 * @param Plugin $plugin Plugin.
	 */
	public function __construct( Plugin $plugin ) {
		$this->plugin = $plugin;
	}

	/**
	 * Register hooks.
	 */
	public function hooks() {
		add_action( 'admin_menu', array( $this, 'menu' ) );
		add_action( 'admin_init', array( $this, 'register' ) );
		add_action( 'admin_init', array( $this, 'privacy_text' ) );
		add_action( 'admin_enqueue_scripts', array( $this, 'assets' ) );
		add_filter( 'plugin_action_links_' . plugin_basename( CWTK_FILE ), array( $this, 'action_links' ) );
	}

	/**
	 * Add the top-level Corbelwise menu.
	 */
	public function menu() {
		add_menu_page(
			__( 'Corbelwise Toolkit', 'corbelwise-toolkit' ),
			__( 'Corbelwise', 'corbelwise-toolkit' ),
			Plugin::capability(),
			self::PAGE,
			array( $this, 'render' ),
			'dashicons-screenoptions',
			61
		);
	}

	/**
	 * Register the option with the Settings API.
	 */
	public function register() {
		register_setting(
			'cwtk',
			Settings::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( $this->plugin->settings(), 'sanitize' ),
			)
		);
		// Users with the filtered capability (not only administrators) may save through options.php.
		add_filter(
			'option_page_capability_cwtk',
			static function () {
				return Plugin::capability();
			}
		);
	}

	/**
	 * Suggested text for the site's privacy policy.
	 */
	public function privacy_text() {
		if ( ! function_exists( 'wp_add_privacy_policy_content' ) ) {
			return;
		}
		$text  = '<p>' . esc_html__( 'Login protection: when someone fails to log in, a salted hash of their IP address is kept for up to the lockout period to block repeated guessing. The address itself is not stored.', 'corbelwise-toolkit' ) . '</p>';
		$text .= '<p>' . esc_html__( 'AI chat (if enabled): messages typed into the chat assistant, together with excerpts of this website\'s public pages, are sent to Anthropic to generate an answer. This site does not store the conversation. Anthropic processes the data under its commercial terms and privacy policy.', 'corbelwise-toolkit' ) . '</p>';
		wp_add_privacy_policy_content( __( 'Corbelwise Toolkit', 'corbelwise-toolkit' ), wp_kses_post( $text ) );
	}

	/**
	 * Settings link on the Plugins screen.
	 *
	 * @param string[] $links Links.
	 * @return string[]
	 */
	public function action_links( $links ) {
		array_unshift( $links, '<a href="' . esc_url( admin_url( 'admin.php?page=' . self::PAGE ) ) . '">' . esc_html__( 'Settings', 'corbelwise-toolkit' ) . '</a>' );
		return $links;
	}

	/**
	 * Enqueue the settings screen stylesheet.
	 *
	 * @param string $hook Admin page hook.
	 */
	public function assets( $hook ) {
		if ( 'toplevel_page_' . self::PAGE !== $hook ) {
			return;
		}
		wp_enqueue_style( 'cwtk-admin', CWTK_URL . 'assets/admin.css', array(), CWTK_VERSION );
	}

	/**
	 * Tabs: modules, each module that is switched on, then advanced.
	 *
	 * @return array<string, string> Tab id => label.
	 */
	private function tabs() {
		$tabs = array( 'modules' => __( 'Modules', 'corbelwise-toolkit' ) );
		foreach ( $this->plugin->settings()->modules() as $id => $module ) {
			if ( $this->plugin->settings()->is_enabled( $id ) && $module->fields() ) {
				$tabs[ $id ] = $module->label();
			}
		}
		$tabs['advanced'] = __( 'Advanced', 'corbelwise-toolkit' );
		return $tabs;
	}

	/**
	 * Render the settings screen.
	 */
	public function render() {
		if ( ! current_user_can( Plugin::capability() ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to manage these settings.', 'corbelwise-toolkit' ), 403 );
		}
		$tabs = $this->tabs();
		$tab  = isset( $_GET['tab'] ) ? sanitize_key( wp_unslash( $_GET['tab'] ) ) : 'modules'; // phpcs:ignore WordPress.Security.NonceVerification.Recommended -- navigation only.
		$tab  = isset( $tabs[ $tab ] ) ? $tab : 'modules';
		?>
		<div class="wrap cwtk-wrap">
			<h1><?php esc_html_e( 'Corbelwise Toolkit', 'corbelwise-toolkit' ); ?></h1>
			<?php settings_errors(); ?>
			<nav class="nav-tab-wrapper" aria-label="<?php esc_attr_e( 'Toolkit sections', 'corbelwise-toolkit' ); ?>">
				<?php foreach ( $tabs as $id => $label ) : ?>
					<a class="nav-tab<?php echo $id === $tab ? ' nav-tab-active' : ''; ?>" href="<?php echo esc_url( add_query_arg( array( 'page' => self::PAGE, 'tab' => $id ), admin_url( 'admin.php' ) ) ); ?>"<?php echo $id === $tab ? ' aria-current="page"' : ''; ?>><?php echo esc_html( $label ); ?></a>
				<?php endforeach; ?>
			</nav>
			<form method="post" action="options.php" class="cwtk-form">
				<?php settings_fields( 'cwtk' ); ?>
				<input type="hidden" name="<?php echo esc_attr( Settings::OPTION ); ?>[_tab]" value="<?php echo esc_attr( $tab ); ?>">
				<?php
				if ( 'modules' === $tab ) {
					$this->render_modules();
				} else {
					$module = $this->plugin->module( $tab );
					if ( $module ) {
						echo '<p class="cwtk-intro">' . esc_html( $module->description() ) . '</p>';
						$reason = $module->paused_reason();
						if ( $reason ) {
							echo '<div class="notice notice-warning inline"><p>' . esc_html( $reason ) . '</p></div>';
						}
						/**
						 * Fires above a module's settings fields, for extra notes or status.
						 *
						 * @param Module $module The module.
						 */
						do_action( 'cwtk_settings_before_fields', $module );
					}
					$this->render_fields( $tab, $this->plugin->settings()->fields( $tab ) );
				}
				submit_button();
				?>
			</form>
		</div>
		<?php
	}

	/**
	 * The Modules tab: a switch per module.
	 */
	private function render_modules() {
		echo '<p class="cwtk-intro">' . esc_html__( 'Switch on only what you need. A module that is off adds no code to your pages.', 'corbelwise-toolkit' ) . '</p>';
		echo '<div class="cwtk-modules">';
		foreach ( $this->plugin->settings()->modules() as $id => $module ) {
			$on     = $this->plugin->settings()->is_enabled( $id );
			$field  = Settings::OPTION . '[modules][' . $id . ']';
			$reason = $on ? $module->paused_reason() : '';
			?>
			<div class="cwtk-module<?php echo $on ? ' is-on' : ''; ?>">
				<label class="cwtk-module__switch">
					<input type="checkbox" name="<?php echo esc_attr( $field ); ?>" value="1" <?php checked( $on ); ?>>
					<span class="cwtk-module__name"><?php echo esc_html( $module->label() ); ?></span>
				</label>
				<p><?php echo esc_html( $module->description() ); ?></p>
				<?php if ( $reason ) : ?>
					<p class="cwtk-module__paused"><?php echo esc_html( $reason ); ?></p>
				<?php endif; ?>
			</div>
			<?php
		}
		echo '</div>';
	}

	/**
	 * Render a group of fields as a form table.
	 *
	 * @param string $group  Module id or 'advanced'.
	 * @param array  $fields Field definitions.
	 */
	private function render_fields( $group, array $fields ) {
		echo '<table class="form-table" role="presentation">';
		foreach ( $fields as $key => $field ) {
			if ( isset( $field['type'] ) && 'heading' === $field['type'] ) {
				echo '<tr><th colspan="2" scope="rowgroup"><h2 class="cwtk-heading">' . esc_html( $field['label'] ) . '</h2>';
				if ( ! empty( $field['help'] ) ) {
					echo '<p class="description">' . esc_html( $field['help'] ) . '</p>';
				}
				echo '</th></tr>';
				continue;
			}
			$id    = 'cwtk-' . $group . '-' . $key;
			$name  = Settings::OPTION . '[' . $group . '][' . $key . ']';
			$value = $this->plugin->settings()->get( $group, $key );
			$type  = isset( $field['type'] ) ? $field['type'] : 'text';
			echo '<tr><th scope="row">';
			if ( 'checkbox' !== $type ) {
				echo '<label for="' . esc_attr( $id ) . '">' . esc_html( $field['label'] ) . '</label>';
			} else {
				echo esc_html( isset( $field['group_label'] ) ? $field['group_label'] : '' );
			}
			echo '</th><td>';
			$this->render_control( $type, $field, $id, $name, $value );
			if ( ! empty( $field['help'] ) ) {
				echo '<p class="description" id="' . esc_attr( $id ) . '-help">' . esc_html( $field['help'] ) . '</p>';
			}
			echo '</td></tr>';
		}
		echo '</table>';
	}

	/**
	 * Render one input.
	 *
	 * @param string $type  Field type.
	 * @param array  $field Field definition.
	 * @param string $id    Element id.
	 * @param string $name  Input name.
	 * @param mixed  $value Current value.
	 */
	private function render_control( $type, array $field, $id, $name, $value ) {
		$described = empty( $field['help'] ) ? '' : ' aria-describedby="' . esc_attr( $id . '-help' ) . '"';
		$maxlength = empty( $field['maxlength'] ) ? '' : ' maxlength="' . (int) $field['maxlength'] . '"';
		$place     = empty( $field['placeholder'] ) ? '' : ' placeholder="' . esc_attr( $field['placeholder'] ) . '"';
		switch ( $type ) {
			case 'checkbox':
				printf( '<label><input type="checkbox" id="%1$s" name="%2$s" value="1" %3$s%4$s> %5$s</label>', esc_attr( $id ), esc_attr( $name ), checked( (bool) $value, true, false ), $described, esc_html( $field['label'] ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- $described is built from escaped parts.
				break;
			case 'select':
				printf( '<select id="%1$s" name="%2$s"%3$s>', esc_attr( $id ), esc_attr( $name ), $described ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped above.
				foreach ( $field['options'] as $option => $label ) {
					printf( '<option value="%1$s" %2$s>%3$s</option>', esc_attr( $option ), selected( (string) $value, (string) $option, false ), esc_html( $label ) );
				}
				echo '</select>';
				break;
			case 'textarea':
			case 'rich':
				printf( '<textarea id="%1$s" name="%2$s" rows="%3$d" class="large-text"%4$s%5$s%6$s>%7$s</textarea>', esc_attr( $id ), esc_attr( $name ), isset( $field['rows'] ) ? (int) $field['rows'] : 4, $described, $maxlength, $place, esc_textarea( (string) $value ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped above.
				break;
			case 'number':
				printf( '<input type="number" id="%1$s" name="%2$s" value="%3$s" class="small-text"%4$s%5$s%6$s>', esc_attr( $id ), esc_attr( $name ), esc_attr( (string) $value ), isset( $field['min'] ) ? ' min="' . (int) $field['min'] . '"' : '', isset( $field['max'] ) ? ' max="' . (int) $field['max'] . '"' : '', $described ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped above.
				break;
			case 'secret':
				$constant = isset( $field['constant'] ) && defined( $field['constant'] ) ? $field['constant'] : '';
				if ( $constant ) {
					/* translators: %s: PHP constant name. */
					echo '<p><strong>' . esc_html( sprintf( __( 'Set in wp-config.php (%s).', 'corbelwise-toolkit' ), $constant ) ) . '</strong></p>';
					break;
				}
				$saved = is_string( $value ) && '' !== $value;
				/* translators: %s: last four characters of the saved key. */
				$hint = $saved ? sprintf( __( 'Saved: ends in %s. Leave empty to keep it.', 'corbelwise-toolkit' ), substr( $value, -4 ) ) : '';
				printf( '<input type="password" id="%1$s" name="%2$s" value="" class="regular-text" autocomplete="new-password" spellcheck="false" placeholder="%3$s"%4$s>', esc_attr( $id ), esc_attr( $name ), esc_attr( $hint ), $described ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped above.
				if ( $saved ) {
					printf( '<br><label><input type="checkbox" name="%1$s" value="1"> %2$s</label>', esc_attr( substr( $name, 0, -1 ) . '__clear]' ), esc_html__( 'Remove the saved key', 'corbelwise-toolkit' ) );
				}
				break;
			default:
				$input_type = in_array( $type, array( 'url', 'email', 'date' ), true ) ? $type : 'text';
				printf( '<input type="%1$s" id="%2$s" name="%3$s" value="%4$s" class="regular-text"%5$s%6$s%7$s>', esc_attr( $input_type ), esc_attr( $id ), esc_attr( $name ), esc_attr( (string) $value ), $described, $maxlength, $place ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped above.
		}
	}
}
