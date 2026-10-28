<?php
/**
 * Per-page settings in the editor: hide the button, or give the page its own message.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Meta box.
 */
class ContextChat_Meta_Box {

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'init', array( __CLASS__, 'register_meta' ) );
		add_action( 'add_meta_boxes', array( __CLASS__, 'add' ) );
		add_action( 'save_post', array( __CLASS__, 'save' ), 10, 2 );
	}

	/**
	 * Register the meta keys as protected, editable only by people who can edit the post.
	 */
	public static function register_meta() {
		$auth = static function ( $allowed, $meta_key, $post_id ) {
			return current_user_can( 'edit_post', $post_id );
		};
		register_meta(
			'post',
			'_contextchat_hide',
			array(
				'type'              => 'boolean',
				'single'            => true,
				'sanitize_callback' => 'rest_sanitize_boolean',
				'auth_callback'     => $auth,
			)
		);
		register_meta(
			'post',
			'_contextchat_message',
			array(
				'type'              => 'string',
				'single'            => true,
				'sanitize_callback' => 'sanitize_textarea_field',
				'auth_callback'     => $auth,
			)
		);
	}

	/**
	 * Add the box to every public post type.
	 */
	public static function add() {
		foreach ( get_post_types( array( 'public' => true ) ) as $type ) {
			if ( 'attachment' === $type ) {
				continue;
			}
			add_meta_box( 'contextchat', __( 'ContextChat', 'contextchat' ), array( __CLASS__, 'render' ), $type, 'side', 'low' );
		}
	}

	/**
	 * Box contents.
	 *
	 * @param WP_Post $post Post.
	 */
	public static function render( $post ) {
		wp_nonce_field( 'contextchat_meta', 'contextchat_meta_nonce' );
		$hide    = (bool) get_post_meta( $post->ID, '_contextchat_hide', true );
		$message = (string) get_post_meta( $post->ID, '_contextchat_message', true );
		?>
		<p>
			<label>
				<input type="checkbox" name="contextchat_hide" value="1" <?php checked( $hide ); ?>>
				<?php esc_html_e( 'Hide the floating chat button here', 'contextchat' ); ?>
			</label>
		</p>
		<p>
			<label for="contextchat_message"><strong><?php esc_html_e( 'Message for this page', 'contextchat' ); ?></strong></label>
			<textarea id="contextchat_message" name="contextchat_message" rows="4" class="widefat" placeholder="<?php echo esc_attr( ContextChat_Settings::get()['default_message'] ); ?>"><?php echo esc_textarea( $message ); ?></textarea>
			<span class="description"><?php esc_html_e( 'Overrides rules and the default message. Placeholders such as {page_title} work here. Leave empty to use your rules.', 'contextchat' ); ?></span>
		</p>
		<?php
	}

	/**
	 * Save the box.
	 *
	 * @param int     $post_id Post ID.
	 * @param WP_Post $post    Post.
	 */
	public static function save( $post_id, $post ) {
		if ( ! isset( $_POST['contextchat_meta_nonce'] ) || ! wp_verify_nonce( sanitize_text_field( wp_unslash( $_POST['contextchat_meta_nonce'] ) ), 'contextchat_meta' ) ) {
			return;
		}
		if ( ( defined( 'DOING_AUTOSAVE' ) && DOING_AUTOSAVE ) || wp_is_post_revision( $post_id ) || ! current_user_can( 'edit_post', $post_id ) ) {
			return;
		}

		if ( ! empty( $_POST['contextchat_hide'] ) ) {
			update_post_meta( $post_id, '_contextchat_hide', true );
		} else {
			delete_post_meta( $post_id, '_contextchat_hide' );
		}

		$message = isset( $_POST['contextchat_message'] ) ? sanitize_textarea_field( wp_unslash( $_POST['contextchat_message'] ) ) : '';
		if ( '' !== trim( $message ) ) {
			update_post_meta( $post_id, '_contextchat_message', mb_substr( $message, 0, 1000 ) );
		} else {
			delete_post_meta( $post_id, '_contextchat_message' );
		}
	}
}
