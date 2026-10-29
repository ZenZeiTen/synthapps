<?php
/**
 * AI assistant module: a writing assistant in the editor and an optional chat for visitors.
 *
 * Off by default. Nothing is sent anywhere until the site owner switches the module on, adds an
 * API key and enables a feature.
 *
 * @package ZenZeiTen\FormaToolkit
 */

namespace ZenZeiTen\FormaToolkit;

defined( 'ABSPATH' ) || exit;

/**
 * AI assistant.
 */
class Ai extends Module {

	const KEY_CONSTANT = 'ZZFT_ANTHROPIC_API_KEY';
	const REST_NS      = 'zzft/v1';

	/**
	 * Characters accepted per chat message and per writing request.
	 */
	const CHAT_MESSAGE_MAX  = 600;
	const CHAT_HISTORY_MAX  = 12;
	const EDITOR_TEXT_MAX   = 20000;
	const EDITOR_HOURLY_MAX = 60;

	/** {@inheritDoc} */
	public function id() {
		return 'ai';
	}

	/** {@inheritDoc} */
	public function label() {
		return __( 'AI assistant', 'zenzeiten-forma-toolkit' );
	}

	/** {@inheritDoc} */
	public function description() {
		return __( 'Optional, powered by Claude from Anthropic. A writing assistant in the editor drafts, rewrites and summarises your content; a chat for visitors answers questions from your own pages and business details. Needs your own Anthropic API key; usage is billed to you by Anthropic.', 'zenzeiten-forma-toolkit' );
	}

	/** {@inheritDoc} */
	public function fields() {
		$models = Anthropic::models();
		return array(
			'h_connection'      => array( 'type' => 'heading', 'label' => __( 'Connection', 'zenzeiten-forma-toolkit' ), 'help' => __( 'Create a key in the Anthropic Console (console.anthropic.com) under API keys. For extra safety, define it in wp-config.php instead: define( \'ZZFT_ANTHROPIC_API_KEY\', \'your-key\' );', 'zenzeiten-forma-toolkit' ) ),
			'api_key'           => array( 'type' => 'secret', 'label' => __( 'Anthropic API key', 'zenzeiten-forma-toolkit' ), 'help' => __( 'Stored encrypted with your site\'s secret keys.', 'zenzeiten-forma-toolkit' ), 'default' => '', 'constant' => self::KEY_CONSTANT ),

			'h_editor'          => array( 'type' => 'heading', 'label' => __( 'Writing assistant', 'zenzeiten-forma-toolkit' ), 'help' => __( 'Opens from the sparkle icon in the top bar of the post and page editor. Available to everyone who can edit posts.', 'zenzeiten-forma-toolkit' ) ),
			'editor_enabled'    => array( 'type' => 'checkbox', 'label' => __( 'Show the writing assistant in the editor', 'zenzeiten-forma-toolkit' ), 'default' => true ),
			'editor_model'      => array( 'type' => 'select', 'label' => __( 'Model', 'zenzeiten-forma-toolkit' ), 'options' => $models, 'default' => 'claude-opus-5-5' ),
			'voice'             => array( 'type' => 'textarea', 'label' => __( 'Your writing style', 'zenzeiten-forma-toolkit' ), 'help' => __( 'For example: "Warm and direct. We say \'we\' and \'you\'. No jargon. British spelling."', 'zenzeiten-forma-toolkit' ), 'default' => '', 'maxlength' => 1500, 'rows' => 3 ),

			'h_chat'            => array( 'type' => 'heading', 'label' => __( 'Visitor chat', 'zenzeiten-forma-toolkit' ), 'help' => __( 'Answers visitors\' questions using your business details, your instructions below and your published pages. Conversations are not stored on your site.', 'zenzeiten-forma-toolkit' ) ),
			'chat_enabled'      => array( 'type' => 'checkbox', 'label' => __( 'Turn on the visitor chat', 'zenzeiten-forma-toolkit' ), 'default' => false ),
			'chat_placement'    => array(
				'type'    => 'select',
				'label'   => __( 'Where it appears', 'zenzeiten-forma-toolkit' ),
				'options' => array(
					'floating'  => __( 'Button in the corner of every page', 'zenzeiten-forma-toolkit' ),
					'shortcode' => __( 'Only where I place the [forma_ai_chat] shortcode', 'zenzeiten-forma-toolkit' ),
				),
				'default' => 'floating',
			),
			'chat_model'        => array( 'type' => 'select', 'label' => __( 'Model', 'zenzeiten-forma-toolkit' ), 'help' => __( 'Every visitor message is one request. Claude Haiku 5.5 costs far less per message than Claude Opus 5.5 and is a good fit for a busy site.', 'zenzeiten-forma-toolkit' ), 'options' => $models, 'default' => 'claude-opus-5-5' ),
			'chat_title'        => array( 'type' => 'text', 'label' => __( 'Chat title', 'zenzeiten-forma-toolkit' ), 'default' => __( 'Ask us anything', 'zenzeiten-forma-toolkit' ), 'maxlength' => 60 ),
			'chat_greeting'     => array( 'type' => 'textarea', 'label' => __( 'Greeting', 'zenzeiten-forma-toolkit' ), 'default' => __( 'Hello! I can answer questions about our services, prices and opening hours. What would you like to know?', 'zenzeiten-forma-toolkit' ), 'maxlength' => 300, 'rows' => 2 ),
			'chat_instructions' => array( 'type' => 'textarea', 'label' => __( 'What the assistant should know', 'zenzeiten-forma-toolkit' ), 'help' => __( 'Facts, policies and answers to common questions, plus anything it must not say. For example: "We do not take bookings by chat; send people to the contact page. Delivery takes 3 to 5 days."', 'zenzeiten-forma-toolkit' ), 'default' => '', 'maxlength' => 4000, 'rows' => 6 ),
			'chat_use_content'  => array( 'type' => 'checkbox', 'label' => __( 'Let the assistant read your published pages and posts to answer', 'zenzeiten-forma-toolkit' ), 'default' => true ),
			'chat_note'         => array( 'type' => 'text', 'label' => __( 'Note under the chat', 'zenzeiten-forma-toolkit' ), 'default' => __( 'Answers are written by AI and can be wrong. Please do not share personal or payment details.', 'zenzeiten-forma-toolkit' ), 'maxlength' => 200 ),
			'chat_hourly_limit' => array( 'type' => 'number', 'label' => __( 'Messages per visitor per hour', 'zenzeiten-forma-toolkit' ), 'default' => 20, 'min' => 1, 'max' => 200 ),
			'chat_daily_limit'  => array( 'type' => 'number', 'label' => __( 'Messages per day for the whole site', 'zenzeiten-forma-toolkit' ), 'help' => __( 'A hard cap that keeps costs predictable. The chat says it is unavailable once the cap is reached and starts again tomorrow.', 'zenzeiten-forma-toolkit' ), 'default' => 300, 'min' => 1, 'max' => 100000 ),
		);
	}

	/**
	 * The API key from wp-config.php or the settings.
	 *
	 * @return string
	 */
	public function api_key() {
		if ( defined( self::KEY_CONSTANT ) && is_string( constant( self::KEY_CONSTANT ) ) && '' !== constant( self::KEY_CONSTANT ) ) {
			return (string) constant( self::KEY_CONSTANT );
		}
		return (string) $this->get( 'api_key' );
	}

	/**
	 * The provider to send requests to.
	 *
	 * @return Provider
	 */
	public function provider() {
		$provider = new Anthropic( $this->api_key() );
		/**
		 * Filters the AI provider. Return any object implementing \ZenZeiTen\FormaToolkit\Provider.
		 *
		 * @param Provider $provider Default Claude provider.
		 * @param Ai       $module   This module.
		 */
		$filtered = apply_filters( 'zzft_ai_provider', $provider, $this );
		return $filtered instanceof Provider ? $filtered : $provider;
	}

	/**
	 * Whether a key is available (or another provider is plugged in).
	 *
	 * @return bool
	 */
	public function is_connected() {
		return '' !== $this->api_key() || ! ( $this->provider() instanceof Anthropic );
	}

	/** {@inheritDoc} */
	public function paused_reason() {
		return $this->is_connected() ? '' : __( 'Add an Anthropic API key under Forma → AI assistant to start.', 'zenzeiten-forma-toolkit' );
	}

	/** {@inheritDoc} */
	public function boot() {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
		add_action( 'zzft_settings_before_fields', array( $this, 'settings_status' ) );
		add_action( 'admin_post_zzft_ai_test', array( $this, 'handle_test' ) );

		if ( ! $this->is_connected() ) {
			return;
		}
		if ( $this->get( 'editor_enabled' ) ) {
			add_action( 'enqueue_block_editor_assets', array( $this, 'editor_assets' ) );
		}
		if ( $this->get( 'chat_enabled' ) ) {
			add_action( 'wp_enqueue_scripts', array( $this, 'register_chat_assets' ) );
			add_shortcode( 'forma_ai_chat', array( $this, 'chat_shortcode' ) );
			if ( 'floating' === $this->get( 'chat_placement' ) ) {
				add_action( 'wp_footer', array( $this, 'render_floating_chat' ) );
			}
		}
	}

	/**
	 * Register the REST routes.
	 */
	public function register_routes() {
		register_rest_route(
			self::REST_NS,
			'/write',
			array(
				'methods'             => \WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'rest_write' ),
				'permission_callback' => static function () {
					return current_user_can( 'edit_posts' );
				},
				'args'                => array(
					'task'        => array(
						'type'     => 'string',
						'required' => true,
						'enum'     => array_keys( Prompts::tasks() ),
					),
					'text'        => array(
						'type'      => 'string',
						'required'  => true,
						'maxLength' => self::EDITOR_TEXT_MAX,
					),
					'title'       => array(
						'type'      => 'string',
						'default'   => '',
						'maxLength' => 300,
					),
					'instruction' => array(
						'type'      => 'string',
						'default'   => '',
						'maxLength' => 1000,
					),
				),
			)
		);
		register_rest_route(
			self::REST_NS,
			'/chat',
			array(
				'methods'             => \WP_REST_Server::CREATABLE,
				'callback'            => array( $this, 'rest_chat' ),
				// Public by design: visitors are not logged in. Protected by the page token, the
				// origin check, size limits, per-visitor limits and the daily cap in rest_chat().
				'permission_callback' => '__return_true',
				'args'                => array(
					'token'    => array(
						'type'      => 'string',
						'required'  => true,
						'maxLength' => 64,
					),
					'page'     => array(
						'type'      => 'string',
						'default'   => '',
						'maxLength' => 2000,
					),
					'messages' => array(
						'type'     => 'array',
						'required' => true,
						'maxItems' => self::CHAT_HISTORY_MAX,
						'items'    => array(
							'type'       => 'object',
							'properties' => array(
								'role'    => array(
									'type' => 'string',
									'enum' => array( 'user', 'assistant' ),
								),
								'content' => array(
									'type'      => 'string',
									'maxLength' => 2000,
								),
							),
						),
					),
				),
			)
		);
	}

	/**
	 * POST /zzft/v1/write: run a writing task for an editor.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function rest_write( \WP_REST_Request $request ) {
		if ( ! $this->get( 'editor_enabled' ) || ! $this->is_connected() ) {
			return new \WP_Error( 'zzft_ai_off', __( 'The writing assistant is switched off.', 'zenzeiten-forma-toolkit' ), array( 'status' => 403 ) );
		}
		$text = trim( (string) $request['text'] );
		if ( '' === $text ) {
			return new \WP_Error( 'zzft_ai_empty_input', __( 'There is no text to work with.', 'zenzeiten-forma-toolkit' ), array( 'status' => 400 ) );
		}
		if ( ! Request::allow( 'editor|' . get_current_user_id(), self::EDITOR_HOURLY_MAX, HOUR_IN_SECONDS ) ) {
			return new \WP_Error( 'zzft_ai_limit', __( 'You have reached the hourly limit for the writing assistant. Please try again later.', 'zenzeiten-forma-toolkit' ), array( 'status' => 429 ) );
		}
		$tasks  = Prompts::tasks();
		$task   = (string) $request['task'];
		$format = $tasks[ $task ]['format'];
		Guard::take( 'editor', 0 );

		$result = $this->provider()->complete(
			array(
				'model'      => (string) $this->get( 'editor_model' ),
				'system'     => Prompts::editor_system( $format, (string) $this->get( 'voice' ) ),
				'messages'   => array(
					array(
						'role'    => 'user',
						'content' => Prompts::editor_message( $task, $text, (string) $request['title'], (string) $request['instruction'] ),
					),
				),
				'max_tokens' => 'draft' === $task || 'expand' === $task ? 16000 : 8000,
				'effort'     => 'medium',
			)
		);
		if ( is_wp_error( $result ) ) {
			return $this->public_error( $result );
		}
		return rest_ensure_response(
			array(
				'task'   => $task,
				'format' => $format,
				'result' => Prompts::clean_output( $format, $result['text'] ),
			)
		);
	}

	/**
	 * POST /zzft/v1/chat: answer a visitor.
	 *
	 * @param \WP_REST_Request $request Request.
	 * @return \WP_REST_Response|\WP_Error
	 */
	public function rest_chat( \WP_REST_Request $request ) {
		if ( ! $this->get( 'chat_enabled' ) || ! $this->is_connected() ) {
			return new \WP_Error( 'zzft_chat_off', __( 'The chat is not available.', 'zenzeiten-forma-toolkit' ), array( 'status' => 404 ) );
		}
		$origin = $request->get_header( 'origin' );
		if ( $origin && ! Request::is_own_url( $origin ) ) {
			return new \WP_Error( 'zzft_chat_origin', __( 'Requests from other sites are not accepted.', 'zenzeiten-forma-toolkit' ), array( 'status' => 403 ) );
		}
		if ( ! Guard::verify( (string) $request['token'] ) ) {
			return new \WP_Error( 'zzft_chat_token', __( 'This page is out of date. Please reload it and try again.', 'zenzeiten-forma-toolkit' ), array( 'status' => 403 ) );
		}

		$messages = $this->clean_history( $request['messages'] );
		if ( is_wp_error( $messages ) ) {
			return $messages;
		}
		if ( ! Request::allow( 'chat|' . Request::ip_key(), (int) $this->get( 'chat_hourly_limit' ), HOUR_IN_SECONDS ) ) {
			return new \WP_Error( 'zzft_chat_limit', __( 'You have sent a lot of messages. Please wait a little before asking again, or contact us directly.', 'zenzeiten-forma-toolkit' ), array( 'status' => 429 ) );
		}
		if ( ! Guard::take( 'chat', (int) $this->get( 'chat_daily_limit' ) ) ) {
			return new \WP_Error( 'zzft_chat_cap', __( 'The chat is resting for today. Please contact us directly and we will be glad to help.', 'zenzeiten-forma-toolkit' ), array( 'status' => 429 ) );
		}

		$question = $messages[ count( $messages ) - 1 ]['content'];
		$page     = (string) $request['page'];
		$context  = $this->get( 'chat_use_content' ) ? Prompts::site_context( $question, $page ) : array(
			'text'    => '',
			'sources' => array(),
		);

		$result = $this->provider()->complete(
			array(
				'model'      => (string) $this->get( 'chat_model' ),
				'system'     => Prompts::chat_system( (string) $this->get( 'chat_instructions' ), (string) $context['text'] ),
				'messages'   => $messages,
				'max_tokens' => 4096,
				'effort'     => 'low',
				'timeout'    => 60,
			)
		);
		if ( is_wp_error( $result ) ) {
			return $this->public_error( $result );
		}
		$reply = trim( wp_strip_all_tags( $result['text'] ) );
		$reply = Settings::cut( preg_replace( '/\*\*(.+?)\*\*/u', '$1', $reply ), 3000 );

		$response = rest_ensure_response(
			array(
				'reply'   => $reply,
				'sources' => array_values( (array) $context['sources'] ),
			)
		);
		$response->header( 'Cache-Control', 'no-store' );
		return $response;
	}

	/**
	 * Validate the conversation sent by the chat: alternating turns, starting and ending with the
	 * visitor, within size limits.
	 *
	 * @param mixed $raw Messages from the request.
	 * @return array|\WP_Error
	 */
	public function clean_history( $raw ) {
		$bad = new \WP_Error( 'zzft_chat_input', __( 'The message could not be read.', 'zenzeiten-forma-toolkit' ), array( 'status' => 400 ) );
		if ( ! is_array( $raw ) || ! $raw || count( $raw ) > self::CHAT_HISTORY_MAX ) {
			return $bad;
		}
		$clean    = array();
		$expected = 'user';
		foreach ( array_values( $raw ) as $message ) {
			if ( ! is_array( $message ) || ! isset( $message['role'], $message['content'] ) || $expected !== $message['role'] || ! is_string( $message['content'] ) ) {
				return $bad;
			}
			$content = trim( sanitize_textarea_field( $message['content'] ) );
			$limit   = 'user' === $message['role'] ? self::CHAT_MESSAGE_MAX : 2000;
			$length  = function_exists( 'mb_strlen' ) ? mb_strlen( $content ) : strlen( $content );
			if ( '' === $content || $length > $limit ) {
				return new \WP_Error( 'zzft_chat_input', __( 'Please keep each message short.', 'zenzeiten-forma-toolkit' ), array( 'status' => 400 ) );
			}
			$clean[]  = array(
				'role'    => $message['role'],
				'content' => $content,
			);
			$expected = 'user' === $expected ? 'assistant' : 'user';
		}
		if ( 'user' !== $clean[ count( $clean ) - 1 ]['role'] ) {
			return $bad;
		}
		return $clean;
	}

	/**
	 * Turn a provider error into a REST error with a status, without leaking provider details to
	 * visitors.
	 *
	 * @param \WP_Error $error Provider error.
	 * @return \WP_Error
	 */
	private function public_error( \WP_Error $error ) {
		$status = 'zzft_ai_busy' === $error->get_error_code() ? 503 : 502;
		if ( 'zzft_ai_refused' === $error->get_error_code() ) {
			$status = 422;
		}
		$message = current_user_can( 'edit_posts' ) || 'zzft_ai_refused' === $error->get_error_code()
			? $error->get_error_message()
			: __( 'Sorry, the assistant could not answer just now. Please try again, or contact us directly.', 'zenzeiten-forma-toolkit' );
		/**
		 * Fires when an AI request fails, for logging.
		 *
		 * @param \WP_Error $error The provider error, including any detail from the API.
		 */
		do_action( 'zzft_ai_error', $error );
		return new \WP_Error( $error->get_error_code(), $message, array( 'status' => $status ) );
	}

	/**
	 * Load the writing assistant in the post and page editor.
	 */
	public function editor_assets() {
		$screen = function_exists( 'get_current_screen' ) ? get_current_screen() : null;
		if ( ! $screen || 'post' !== $screen->base || ! current_user_can( 'edit_posts' ) ) {
			return;
		}
		wp_enqueue_script( 'zzft-ai-editor', ZZFT_URL . 'assets/ai-editor.js', array( 'wp-plugins', 'wp-edit-post', 'wp-element', 'wp-components', 'wp-data', 'wp-api-fetch', 'wp-blocks', 'wp-block-editor', 'wp-i18n' ), ZZFT_VERSION, true );
		wp_enqueue_style( 'zzft-ai-editor', ZZFT_URL . 'assets/ai-editor.css', array(), ZZFT_VERSION );
		wp_add_inline_script(
			'zzft-ai-editor',
			'window.zzftAi = ' . wp_json_encode(
				array(
					'seo'    => Plugin::instance()->is_active( 'seo' ),
					'seoKey' => Seo::META_KEY,
				)
			) . ';',
			'before'
		);
		wp_set_script_translations( 'zzft-ai-editor', 'zenzeiten-forma-toolkit', ZZFT_DIR . 'languages' );
	}

	/**
	 * Register the chat script and style; they are enqueued only where the chat renders.
	 */
	public function register_chat_assets() {
		wp_register_style( 'zzft-chat', ZZFT_URL . 'assets/chat.css', array(), ZZFT_VERSION );
		wp_register_script(
			'zzft-chat',
			ZZFT_URL . 'assets/chat.js',
			array(),
			ZZFT_VERSION,
			array(
				'in_footer' => true,
				'strategy'  => 'defer',
			)
		);
	}

	/**
	 * Markup of a chat container. The script builds the conversation inside it.
	 *
	 * @param string $mode 'floating' or 'inline'.
	 * @return string
	 */
	public function chat_markup( $mode ) {
		wp_enqueue_style( 'zzft-chat' );
		wp_enqueue_script( 'zzft-chat' );
		$labels = array(
			'open'        => __( 'Chat with us', 'zenzeiten-forma-toolkit' ),
			'close'       => __( 'Close chat', 'zenzeiten-forma-toolkit' ),
			'placeholder' => __( 'Type your question…', 'zenzeiten-forma-toolkit' ),
			'send'        => __( 'Send', 'zenzeiten-forma-toolkit' ),
			'thinking'    => __( 'Writing an answer…', 'zenzeiten-forma-toolkit' ),
			'error'       => __( 'Sorry, something went wrong. Please try again.', 'zenzeiten-forma-toolkit' ),
			'you'         => __( 'You', 'zenzeiten-forma-toolkit' ),
			'assistant'   => __( 'Assistant', 'zenzeiten-forma-toolkit' ),
			'tooLong'     => __( 'Please keep your message under 600 characters.', 'zenzeiten-forma-toolkit' ),
		);
		$config = array(
			'endpoint' => rest_url( self::REST_NS . '/chat' ),
			'token'    => Guard::token(),
			'mode'     => $mode,
			'title'    => (string) $this->get( 'chat_title' ),
			'greeting' => (string) $this->get( 'chat_greeting' ),
			'note'     => (string) $this->get( 'chat_note' ),
			'max'      => self::CHAT_MESSAGE_MAX,
			'labels'   => $labels,
		);
		return '<div class="zzft-chat zzft-chat--' . esc_attr( $mode ) . '" data-zzft-chat="' . esc_attr( wp_json_encode( $config ) ) . '"></div>';
	}

	/**
	 * Print the floating chat button.
	 */
	public function render_floating_chat() {
		if ( is_admin() || is_feed() || is_embed() ) {
			return;
		}
		echo $this->chat_markup( 'floating' ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in chat_markup().
	}

	/**
	 * [forma_ai_chat]: the chat inside page content.
	 *
	 * @return string
	 */
	public function chat_shortcode() {
		return $this->chat_markup( 'inline' );
	}

	/**
	 * Status box above the AI settings: connection, today's usage and a test button.
	 *
	 * @param Module $module Module whose tab is showing.
	 */
	public function settings_status( $module ) {
		if ( $module !== $this ) {
			return;
		}
		$usage = Guard::usage();
		echo '<div class="zzft-status">';
		if ( $this->is_connected() ) {
			echo '<p><strong>' . esc_html__( 'Connected.', 'zenzeiten-forma-toolkit' ) . '</strong> ';
			/* translators: 1: chat messages today, 2: writing requests today. */
			echo esc_html( sprintf( __( 'Today: %1$d chat messages, %2$d writing requests.', 'zenzeiten-forma-toolkit' ), $usage['chat'], $usage['editor'] ) );
			echo ' <a href="' . esc_url( wp_nonce_url( admin_url( 'admin-post.php?action=zzft_ai_test' ), 'zzft_ai_test' ) ) . '">' . esc_html__( 'Send a test request', 'zenzeiten-forma-toolkit' ) . '</a></p>';
		}
		$notice = get_transient( 'zzft_ai_test_' . get_current_user_id() );
		if ( is_array( $notice ) ) {
			delete_transient( 'zzft_ai_test_' . get_current_user_id() );
			printf( '<div class="notice notice-%1$s inline"><p>%2$s</p></div>', $notice['ok'] ? 'success' : 'error', esc_html( $notice['message'] ) );
		}
		echo '</div>';
	}

	/**
	 * Send a tiny request to check the key and model, then return to the settings screen.
	 */
	public function handle_test() {
		if ( ! current_user_can( Plugin::capability() ) ) {
			wp_die( esc_html__( 'Sorry, you are not allowed to do that.', 'zenzeiten-forma-toolkit' ), 403 );
		}
		check_admin_referer( 'zzft_ai_test' );
		$result = $this->provider()->complete(
			array(
				'model'      => $this->get( 'chat_enabled' ) ? (string) $this->get( 'chat_model' ) : (string) $this->get( 'editor_model' ),
				'messages'   => array(
					array(
						'role'    => 'user',
						'content' => 'Reply with the single word OK.',
					),
				),
				'max_tokens' => 1024,
				'effort'     => 'low',
				'timeout'    => 45,
			)
		);
		if ( is_wp_error( $result ) ) {
			$data    = $result->get_error_data();
			$message = $result->get_error_message() . ( is_array( $data ) && ! empty( $data['detail'] ) ? ' (' . $data['detail'] . ')' : '' );
			$notice  = array(
				'ok'      => false,
				'message' => $message,
			);
		} else {
			$notice = array(
				'ok'      => true,
				/* translators: %s: model id. */
				'message' => sprintf( __( 'It works. %s answered.', 'zenzeiten-forma-toolkit' ), $result['model'] ),
			);
		}
		set_transient( 'zzft_ai_test_' . get_current_user_id(), $notice, 5 * MINUTE_IN_SECONDS );
		wp_safe_redirect( admin_url( 'admin.php?page=zzft&tab=ai' ) );
		exit;
	}
}
