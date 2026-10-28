<?php
/**
 * Settings: defaults, reading and strict sanitising.
 *
 * All settings live in one option, `contextchat_settings`. Every value is checked on save, so
 * the rest of the plugin can trust what it reads.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Settings store.
 */
class ContextChat_Settings {

	const OPTION = 'contextchat_settings';

	/** Rule types and what they compare against. */
	const RULE_TYPES = array( 'url_contains', 'page', 'post_type', 'category', 'product_category', 'product', 'front_page', 'search' );

	/** Cached settings for this request. @var array|null */
	private static $cache = null;

	/**
	 * Register the option everywhere (admin, REST, WP-CLI), so every write is sanitised.
	 */
	public static function register() {
		register_setting(
			'contextchat',
			self::OPTION,
			array(
				'type'              => 'object',
				'sanitize_callback' => array( __CLASS__, 'sanitize' ),
				'default'           => self::defaults(),
				'show_in_rest'      => false,
			)
		);
		add_action( 'update_option_' . self::OPTION, array( __CLASS__, 'flush' ) );
		add_action( 'add_option_' . self::OPTION, array( __CLASS__, 'flush' ) );
	}

	/**
	 * Default settings.
	 *
	 * @return array
	 */
	public static function defaults() {
		$hours = array();
		for ( $day = 0; $day < 7; $day++ ) {
			$hours[] = array(
				'on'    => $day >= 1 && $day <= 5,
				'start' => '09:00',
				'end'   => '17:00',
			);
		}

		return array(
			'enabled'          => true,
			'phone'            => '',
			'country_code'     => '',
			'mode'             => 'widget',
			'agents'           => array(),
			'default_message'  => __( 'Hi! I have a question about "{page_title}" ({page_url}).', 'contextchat' ),
			'rules'            => array(),
			'composer'         => true,
			'position'         => 'right',
			'offset_x'         => 24,
			'offset_y'         => 24,
			'size'             => 60,
			'color'            => '#25d366',
			'icon_color'       => '#ffffff',
			'header_color'     => '#075e54',
			'label'            => __( 'Chat with us', 'contextchat' ),
			'label_display'    => 'desktop',
			'pulse'            => true,
			'delay'            => 0,
			'show_on'          => 'all',
			'header_title'     => __( 'Start a conversation', 'contextchat' ),
			'header_subtitle'  => __( 'We usually reply within a few minutes.', 'contextchat' ),
			'greeting'         => __( 'Hi there! How can we help you today?', 'contextchat' ),
			'hours_enabled'    => false,
			'hours'            => $hours,
			'offline_behavior' => 'note',
			'offline_note'     => __( 'We\'re offline right now. Send your message anyway and we\'ll reply as soon as we\'re back.', 'contextchat' ),
			'offline_suffix'   => '',
			'desktop_target'   => 'web',
			'exclude_ids'      => '',
			'exclude_paths'    => '',
			'woo_button'       => true,
			'woo_button_text'  => __( 'Ask about this product', 'contextchat' ),
			'woo_message'      => __( 'Hi! I\'m interested in {product_name} ({product_price}). {page_url}', 'contextchat' ),
			'analytics'        => true,
			'datalayer'        => true,
			'retention_days'   => 180,
		);
	}

	/**
	 * Current settings, merged over the defaults.
	 *
	 * @return array
	 */
	public static function get() {
		if ( null === self::$cache ) {
			$saved       = get_option( self::OPTION, array() );
			self::$cache = array_merge( self::defaults(), is_array( $saved ) ? $saved : array() );
		}
		return self::$cache;
	}

	/**
	 * Forget cached settings, e.g. after an update.
	 */
	public static function flush() {
		self::$cache = null;
	}

	/**
	 * Clean a submitted settings array. Safe to run on already-clean data.
	 *
	 * @param mixed $input Raw input.
	 * @return array
	 */
	public static function sanitize( $input ) {
		self::flush();
		// options.php has already unslashed the submitted value.
		$input = is_array( $input ) ? $input : array();
		$d     = self::defaults();
		$out   = array();

		$out['enabled']      = self::bool( $input, 'enabled' );
		$out['country_code'] = substr( preg_replace( '/\D+/', '', (string) self::val( $input, 'country_code', '' ) ), 0, 4 );
		$out['phone']        = ContextChat_Template::normalize_phone( self::val( $input, 'phone', '' ), $out['country_code'] );
		$out['mode']         = self::choice( $input, 'mode', array( 'widget', 'direct' ), $d['mode'] );

		$out['agents'] = array();
		foreach ( (array) self::val( $input, 'agents', array() ) as $agent ) {
			$clean = self::sanitize_agent( $agent, $out['country_code'] );
			if ( $clean ) {
				$out['agents'][] = $clean;
			}
		}
		$out['agents'] = array_slice( $out['agents'], 0, 20 );
		$agent_ids     = wp_list_pluck( $out['agents'], 'id' );

		$out['default_message'] = self::message( $input, 'default_message', $d['default_message'] );

		$out['rules'] = array();
		foreach ( (array) self::val( $input, 'rules', array() ) as $rule ) {
			$clean = self::sanitize_rule( $rule, $agent_ids );
			if ( $clean ) {
				$out['rules'][] = $clean;
			}
		}
		$out['rules'] = array_slice( $out['rules'], 0, 50 );

		$out['composer']      = self::bool( $input, 'composer' );
		$out['position']      = self::choice( $input, 'position', array( 'right', 'left' ), $d['position'] );
		$out['offset_x']      = self::int( $input, 'offset_x', 0, 200, $d['offset_x'] );
		$out['offset_y']      = self::int( $input, 'offset_y', 0, 300, $d['offset_y'] );
		$out['size']          = self::int( $input, 'size', 40, 96, $d['size'] );
		$out['color']         = self::color( $input, 'color', $d['color'] );
		$out['icon_color']    = self::color( $input, 'icon_color', $d['icon_color'] );
		$out['header_color']  = self::color( $input, 'header_color', $d['header_color'] );
		$out['label']         = self::text( $input, 'label', 60 );
		$out['label_display'] = self::choice( $input, 'label_display', array( 'always', 'desktop', 'never' ), $d['label_display'] );
		$out['pulse']         = self::bool( $input, 'pulse' );
		$out['delay']         = self::int( $input, 'delay', 0, 120, 0 );
		$out['show_on']       = self::choice( $input, 'show_on', array( 'all', 'desktop', 'mobile' ), $d['show_on'] );

		$out['header_title']    = self::text( $input, 'header_title', 80 );
		$out['header_subtitle'] = self::text( $input, 'header_subtitle', 120 );
		$out['greeting']        = self::message( $input, 'greeting', '' );

		$out['hours_enabled'] = self::bool( $input, 'hours_enabled' );
		$out['hours']         = array();
		$hours_in             = (array) self::val( $input, 'hours', array() );
		for ( $day = 0; $day < 7; $day++ ) {
			$row            = isset( $hours_in[ $day ] ) && is_array( $hours_in[ $day ] ) ? $hours_in[ $day ] : array();
			$out['hours'][] = array(
				'on'    => self::bool( $row, 'on' ),
				'start' => self::time( isset( $row['start'] ) ? $row['start'] : '', $d['hours'][ $day ]['start'] ),
				'end'   => self::time( isset( $row['end'] ) ? $row['end'] : '', $d['hours'][ $day ]['end'] ),
			);
		}
		$out['offline_behavior'] = self::choice( $input, 'offline_behavior', array( 'note', 'hide' ), $d['offline_behavior'] );
		$out['offline_note']     = self::message( $input, 'offline_note', '' );
		$out['offline_suffix']   = self::message( $input, 'offline_suffix', '' );

		$out['desktop_target'] = self::choice( $input, 'desktop_target', array( 'web', 'app' ), $d['desktop_target'] );
		$out['exclude_ids']    = implode( ', ', array_filter( array_map( 'absint', preg_split( '/[\s,]+/', (string) self::val( $input, 'exclude_ids', '' ) ) ) ) );
		$paths                 = array_filter( array_map( 'trim', preg_split( '/\R/', (string) self::val( $input, 'exclude_paths', '' ) ) ) );
		$out['exclude_paths']  = implode( "\n", array_slice( array_map( 'sanitize_text_field', $paths ), 0, 100 ) );

		$out['woo_button']      = self::bool( $input, 'woo_button' );
		$out['woo_button_text'] = self::text( $input, 'woo_button_text', 60 );
		$out['woo_message']     = self::message( $input, 'woo_message', $d['woo_message'] );

		$out['analytics']      = self::bool( $input, 'analytics' );
		$out['datalayer']      = self::bool( $input, 'datalayer' );
		$out['retention_days'] = self::int( $input, 'retention_days', 7, 3650, $d['retention_days'] );

		return $out;
	}

	/**
	 * Clean one agent. Returns null for an agent without a usable number.
	 *
	 * @param mixed  $agent        Raw agent.
	 * @param string $country_code Default country code.
	 * @return array|null
	 */
	public static function sanitize_agent( $agent, $country_code ) {
		if ( ! is_array( $agent ) ) {
			return null;
		}
		$phone = ContextChat_Template::normalize_phone( self::val( $agent, 'phone', '' ), $country_code );
		if ( '' === $phone ) {
			return null;
		}
		$id = sanitize_key( self::val( $agent, 'id', '' ) );

		return array(
			'id'       => '' !== $id ? substr( $id, 0, 32 ) : 'a' . substr( md5( $phone . wp_rand() ), 0, 8 ),
			'name'     => self::text( $agent, 'name', 60 ),
			'role'     => self::text( $agent, 'role', 80 ),
			'phone'    => $phone,
			'avatar'   => esc_url_raw( (string) self::val( $agent, 'avatar', '' ), array( 'http', 'https' ) ),
			'always'   => self::bool( $agent, 'always' ),
			'disabled' => self::bool( $agent, 'disabled' ),
		);
	}

	/**
	 * Clean one context rule. Returns null for an incomplete rule.
	 *
	 * @param mixed $rule      Raw rule.
	 * @param array $agent_ids Known agent IDs.
	 * @return array|null
	 */
	public static function sanitize_rule( $rule, array $agent_ids ) {
		if ( ! is_array( $rule ) ) {
			return null;
		}
		$type    = self::choice( $rule, 'type', self::RULE_TYPES, '' );
		$value   = self::text( $rule, 'value', 200 );
		$message = self::message( $rule, 'message', '' );
		$agents  = array_values( array_intersect( array_map( 'sanitize_key', (array) self::val( $rule, 'agents', array() ) ), $agent_ids ) );

		$needs_value = in_array( $type, array( 'url_contains', 'page', 'post_type', 'category', 'product_category' ), true );
		if ( '' === $type || ( $needs_value && '' === $value ) || ( '' === $message && ! $agents ) ) {
			return null;
		}

		$id = sanitize_key( self::val( $rule, 'id', '' ) );

		return array(
			'id'      => '' !== $id ? substr( $id, 0, 32 ) : 'r' . substr( md5( $type . $value . wp_rand() ), 0, 8 ),
			'label'   => self::text( $rule, 'label', 80 ),
			'type'    => $type,
			'value'   => $value,
			'message' => $message,
			'agents'  => $agents,
		);
	}

	/**
	 * Read a key from an array.
	 *
	 * @param array  $arr     Source.
	 * @param string $key     Key.
	 * @param mixed  $default Fallback.
	 * @return mixed
	 */
	private static function val( $arr, $key, $default ) {
		return is_array( $arr ) && array_key_exists( $key, $arr ) ? $arr[ $key ] : $default;
	}

	/**
	 * Checkbox value. A missing key means unchecked.
	 *
	 * @param array  $arr Source.
	 * @param string $key Key.
	 * @return bool
	 */
	private static function bool( $arr, $key ) {
		$v = self::val( $arr, $key, false );
		return true === $v || 1 === $v || '1' === $v || 'on' === $v || 'yes' === $v || 'true' === $v;
	}

	/**
	 * One of a fixed set of values.
	 *
	 * @param array  $arr     Source.
	 * @param string $key     Key.
	 * @param array  $allowed Allowed values.
	 * @param string $default Fallback.
	 * @return string
	 */
	private static function choice( $arr, $key, array $allowed, $default ) {
		$v = (string) self::val( $arr, $key, $default );
		return in_array( $v, $allowed, true ) ? $v : $default;
	}

	/**
	 * Whole number within a range.
	 *
	 * @param array  $arr     Source.
	 * @param string $key     Key.
	 * @param int    $min     Minimum.
	 * @param int    $max     Maximum.
	 * @param int    $default Fallback when not numeric.
	 * @return int
	 */
	private static function int( $arr, $key, $min, $max, $default ) {
		$v = self::val( $arr, $key, $default );
		if ( ! is_numeric( $v ) ) {
			return $default;
		}
		return max( $min, min( $max, (int) $v ) );
	}

	/**
	 * Single-line text with a length cap.
	 *
	 * @param array  $arr Source.
	 * @param string $key Key.
	 * @param int    $max Maximum characters.
	 * @return string
	 */
	private static function text( $arr, $key, $max ) {
		return mb_substr( sanitize_text_field( (string) self::val( $arr, $key, '' ) ), 0, $max );
	}

	/**
	 * Multi-line plain text such as a message template. Tags are stripped; line breaks stay.
	 *
	 * @param array  $arr     Source.
	 * @param string $key     Key.
	 * @param string $default Used when the key is missing (not when it is empty).
	 * @return string
	 */
	private static function message( $arr, $key, $default ) {
		if ( ! is_array( $arr ) || ! array_key_exists( $key, $arr ) ) {
			return $default;
		}
		return mb_substr( sanitize_textarea_field( (string) $arr[ $key ] ), 0, 1000 );
	}

	/**
	 * Hex colour.
	 *
	 * @param array  $arr     Source.
	 * @param string $key     Key.
	 * @param string $default Fallback.
	 * @return string
	 */
	private static function color( $arr, $key, $default ) {
		$v = sanitize_hex_color( (string) self::val( $arr, $key, '' ) );
		return $v ? strtolower( $v ) : $default;
	}

	/**
	 * 24-hour time as HH:MM.
	 *
	 * @param string $v       Raw.
	 * @param string $default Fallback.
	 * @return string
	 */
	private static function time( $v, $default ) {
		return preg_match( '/^([01]\d|2[0-3]):[0-5]\d$/', (string) $v ) ? (string) $v : $default;
	}
}
