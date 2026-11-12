<?php
/**
 * Agent identity: tells verified crawlers and AI agents from spoofed ones, scores agents that
 * misbehave, and sets two traps for automation that ignores robots.txt or harvests keys.
 *
 * @package ZenZeiTenBastion
 */

namespace ZenZeiTenBastion;

defined( 'ABSPATH' ) || exit;

/**
 * A user-agent is a claim, never proof. A request that names a known agent is checked against the
 * address list that agent's vendor publishes. The lists are fetched once a day by cron and read
 * only when a request makes such a claim, so ordinary visitors cost nothing.
 *
 * check() runs on plugins_loaded, before WordPress may load translations, so the text it stores
 * and shows is plain English.
 */
final class Agents {

	const LISTS_OPTION = 'zbst_agent_lists';
	const TRAPS_OPTION = 'zbst_agent_traps';

	/**
	 * A list older than this (three days, in seconds) proves nothing: its verdicts become unknown.
	 */
	const FRESH_SECONDS = 259200;

	/**
	 * Largest list accepted, in bytes and in prefixes.
	 */
	const MAX_BYTES    = 2097152;
	const MAX_PREFIXES = 20000;

	/**
	 * A spoofing address is logged at most once in this many seconds; it is refused every time.
	 */
	const SPOOF_LOG_SECONDS = 600;

	/**
	 * Lists as stored, read once per request.
	 *
	 * @var array|null
	 */
	private static $lists = null;

	/**
	 * Results of identify() in this request.
	 *
	 * @var array
	 */
	private static $memo = array();

	/**
	 * Register the front-end hooks for the traps.
	 */
	public static function register() {
		add_filter( 'robots_txt', Guard::wrap( array( __CLASS__, 'robots_txt' ) ), 10, 1 );
		add_action( 'wp_head', Guard::wrap( array( __CLASS__, 'head_comment' ) ), 99 );
		add_action( 'wp_footer', Guard::wrap( array( __CLASS__, 'footer_link' ) ), 99 );
		add_filter( 'wp_speculation_rules_href_exclude_paths', Guard::wrap( array( __CLASS__, 'exclude_paths' ) ), 10, 1 );
	}

	/**
	 * Forget what this request has read (after the lists change, and between tests).
	 */
	public static function reset() {
		self::$lists = null;
		self::$memo  = array();
	}

	/**
	 * Known agents. The first entry with a token found in the user-agent wins, so more specific
	 * tokens come first.
	 *
	 * Keys: tokens (matched without regard to case), vendor, kind, urls (the vendor's published
	 * address lists; none means the vendor publishes no list) and fetcher (true for agents that
	 * fetch a page because a person asked, which may ignore robots.txt by design).
	 *
	 * Google-Extended is a robots.txt token, not a user-agent, so it is not here.
	 *
	 * @return array
	 */
	public static function registry() {
		$google = 'https://developers.google.com/static/crawling/ipranges/';
		return array(
			'google-agent'        => array(
				'tokens'  => array( 'Google-Agent' ),
				'vendor'  => 'Google',
				'kind'    => 'user-triggered agent',
				'urls'    => array( $google . 'user-triggered-agents.json' ),
				'fetcher' => true,
			),
			// Google publishes two lists for its user-triggered fetchers and does not say which
			// fetcher uses which, so an address in either one is accepted.
			'google-fetchers'     => array(
				'tokens'  => array( 'Google-Site-Verification', 'Google-Read-Aloud' ),
				'vendor'  => 'Google',
				'kind'    => 'user-triggered fetcher',
				'urls'    => array( $google . 'user-triggered-fetchers-google.json', $google . 'user-triggered-fetchers.json' ),
				'fetcher' => true,
			),
			'google-special'      => array(
				'tokens'  => array( 'AdsBot-Google', 'Mediapartners-Google' ),
				'vendor'  => 'Google',
				'kind'    => 'special crawler',
				'urls'    => array( $google . 'special-crawlers.json' ),
				'fetcher' => false,
			),
			'google-googlebot'    => array(
				'tokens'  => array( 'Googlebot', 'GoogleOther' ),
				'vendor'  => 'Google',
				'kind'    => 'search crawler',
				'urls'    => array( $google . 'common-crawlers.json' ),
				'fetcher' => false,
			),
			'microsoft-bingbot'   => array(
				'tokens'  => array( 'bingbot' ),
				'vendor'  => 'Microsoft',
				'kind'    => 'search crawler',
				'urls'    => array( 'https://www.bing.com/toolbox/bingbot.json' ),
				'fetcher' => false,
			),
			'openai-gptbot'       => array(
				'tokens'  => array( 'GPTBot' ),
				'vendor'  => 'OpenAI',
				'kind'    => 'training crawler',
				'urls'    => array( 'https://openai.com/gptbot.json' ),
				'fetcher' => false,
			),
			'openai-searchbot'    => array(
				'tokens'  => array( 'OAI-SearchBot' ),
				'vendor'  => 'OpenAI',
				'kind'    => 'search crawler',
				'urls'    => array( 'https://openai.com/searchbot.json' ),
				'fetcher' => false,
			),
			'openai-chatgpt-user' => array(
				'tokens'  => array( 'ChatGPT-User' ),
				'vendor'  => 'OpenAI',
				'kind'    => 'user-triggered fetcher',
				'urls'    => array( 'https://openai.com/chatgpt-user.json' ),
				'fetcher' => true,
			),
			'anthropic-claude'    => array(
				'tokens'  => array( 'ClaudeBot', 'Claude-User', 'Claude-SearchBot' ),
				'vendor'  => 'Anthropic',
				'kind'    => 'crawler and fetcher',
				'urls'    => array( 'https://claude.com/crawling/bots.json' ),
				'fetcher' => false,
			),
			// Anthropic's hosted browser publishes no address list: it can be neither verified
			// nor called spoofed.
			'anthropic-agent'     => array(
				'tokens'  => array( 'Claude-Agent' ),
				'vendor'  => 'Anthropic',
				'kind'    => 'hosted browser',
				'urls'    => array(),
				'fetcher' => false,
			),
			'perplexity-user'     => array(
				'tokens'  => array( 'Perplexity-User' ),
				'vendor'  => 'Perplexity',
				'kind'    => 'user-triggered fetcher',
				'urls'    => array( 'https://www.perplexity.com/perplexity-user.json' ),
				'fetcher' => true,
			),
			'perplexity-bot'      => array(
				'tokens'  => array( 'PerplexityBot' ),
				'vendor'  => 'Perplexity',
				'kind'    => 'search crawler',
				'urls'    => array( 'https://www.perplexity.com/perplexitybot.json' ),
				'fetcher' => false,
			),
		);
	}

	/**
	 * The stored lists, keyed by registry ID.
	 *
	 * @return array
	 */
	public static function lists() {
		if ( null === self::$lists ) {
			$stored      = get_option( self::LISTS_OPTION, array() );
			self::$lists = is_array( $stored ) ? $stored : array();
		}
		return self::$lists;
	}

	/**
	 * Who a request claims to be, and whether its address backs the claim.
	 *
	 * Verdicts: none (names no known agent), verified (the address is in the agent's fresh list),
	 * spoofed (the list is fresh and the address is not in it), unknown (the list is missing or
	 * stale, or the agent has no published list). Unknown is never scored: the module fails open.
	 *
	 * @param string $ip Address.
	 * @param string $ua User-agent.
	 * @return array Keys: verdict, id, token, fetcher, age (days since the list was fetched, or null).
	 */
	public static function identify( $ip, $ua ) {
		$key = $ip . "\n" . $ua;
		if ( isset( self::$memo[ $key ] ) ) {
			return self::$memo[ $key ];
		}
		$out = array(
			'verdict' => 'none',
			'id'      => '',
			'token'   => '',
			'fetcher' => false,
			'age'     => null,
		);
		foreach ( '' === (string) $ua ? array() : self::registry() as $id => $agent ) {
			foreach ( $agent['tokens'] as $token ) {
				if ( false !== stripos( $ua, $token ) ) {
					$out = array_merge(
						$out,
						array(
							'verdict' => 'unknown',
							'id'      => $id,
							'token'   => $token,
							'fetcher' => $agent['fetcher'],
						)
					);
					break 2;
				}
			}
		}
		$ip = IP::normalize( $ip );
		if ( '' !== $out['id'] && '' !== $ip ) {
			$lists = self::lists();
			$list  = isset( $lists[ $out['id'] ] ) && is_array( $lists[ $out['id'] ] ) ? $lists[ $out['id'] ] : array();
			if ( ! empty( $list['fetched_at'] ) && ! empty( $list['prefixes'] ) && is_array( $list['prefixes'] ) ) {
				$age        = max( 0, time() - (int) $list['fetched_at'] );
				$out['age'] = (int) floor( $age / DAY_IN_SECONDS );
				if ( $age <= self::FRESH_SECONDS ) {
					$out['verdict'] = self::in_prefixes( $ip, $list['prefixes'] ) ? 'verified' : 'spoofed';
				}
			}
		}
		// A long-running process (WP-CLI, tests) must not grow this without bound.
		if ( count( self::$memo ) > 50 ) {
			self::$memo = array();
		}
		self::$memo[ $key ] = $out;
		return $out;
	}

	/**
	 * Whether an address is inside any of a list's prefixes. Only prefixes of the address's own
	 * family are parsed.
	 *
	 * @param string   $ip       Normalized address.
	 * @param string[] $prefixes Canonical CIDR strings.
	 * @return bool
	 */
	private static function in_prefixes( $ip, array $prefixes ) {
		$v6 = IP::is_v6( $ip );
		foreach ( $prefixes as $prefix ) {
			if ( is_string( $prefix ) && IP::is_v6( $prefix ) === $v6 && IP::in_range( $ip, $prefix ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * The current request's verdict, or none while the module is off.
	 *
	 * @return string
	 */
	public static function verdict() {
		if ( 'off' === Settings::get( 'agent_mode' ) ) {
			return 'none';
		}
		return self::identify( Request::ip(), Request::user_agent() )['verdict'];
	}

	/**
	 * The request's path, decoded.
	 *
	 * @return string
	 */
	private static function path() {
		// phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- compared against fixed paths only.
		$uri = isset( $_SERVER['REQUEST_URI'] ) ? (string) $_SERVER['REQUEST_URI'] : '/';
		return rawurldecode( (string) wp_parse_url( $uri, PHP_URL_PATH ) );
	}

	/**
	 * Whether the request is for robots.txt.
	 *
	 * @return bool
	 */
	private static function is_robots() {
		return (bool) preg_match( '#/robots\.txt$#i', self::path() );
	}

	/**
	 * A verified agent is never refused robots.txt, even from a blocked address: Anthropic warns
	 * that blocking its addresses can stop it from reading the rules it would follow.
	 *
	 * @return bool
	 */
	public static function spared_on_robots() {
		return self::is_robots() && 'verified' === self::verdict();
	}

	/**
	 * Every request: judge the agent's identity and behaviour, and the traps.
	 *
	 * @return bool True when the firewall already handled this request here, so the caller must
	 *              not run it again.
	 */
	public static function check() {
		$mode = Settings::get( 'agent_mode' );
		if ( 'off' === $mode ) {
			return false;
		}
		$ip   = Request::ip();
		$info = self::identify( $ip, Request::user_agent() );
		$trap = self::trap_hit();
		if ( '' === $trap && ! in_array( $info['verdict'], array( 'verified', 'spoofed' ), true ) ) {
			return false;
		}
		// Staff and the addresses administrators sign in from are left alone, as by the firewall.
		if ( Guard::cookie_user_id() || Blocklist::is_admin_ip( $ip ) ) {
			return false;
		}
		$protect = 'protect' === $mode;
		if ( '' !== $trap ) {
			return self::judge_trap( $trap, $info, $protect );
		}
		if ( 'spoofed' === $info['verdict'] ) {
			return self::judge_spoof( $ip, $info, $protect );
		}
		return self::judge_verified( $ip, $info, $protect );
	}

	/**
	 * Details text for an event.
	 *
	 * @param array  $info  From identify().
	 * @param string $extra More key=value pairs.
	 * @return string
	 */
	private static function details( array $info, $extra = '' ) {
		$text = 'verdict=' . $info['verdict'];
		if ( '' !== $info['token'] ) {
			$text .= ' claimed=' . $info['token'];
		}
		if ( null !== $info['age'] ) {
			$text .= ' list_age=' . $info['age'] . 'd';
		}
		return '' !== $extra ? $text . ' ' . $extra : $text;
	}

	/**
	 * Record an agent event, unless the request also breaks a firewall rule. Then the firewall
	 * logs it (and refuses it, in Protect mode) and this module adds nothing: one request never
	 * scores twice.
	 *
	 * @param array|null $event Event for Guard::report(), or null to only hand over to the firewall.
	 * @return bool True when the firewall handled the request.
	 */
	private static function log( $event ) {
		if ( Firewall::pending() ) {
			Firewall::run();
			return true;
		}
		if ( $event ) {
			Guard::report( $event );
		}
		return false;
	}

	/**
	 * A request that claims to be a known agent from an address outside that agent's list.
	 *
	 * @param string $ip      Address.
	 * @param array  $info    From identify().
	 * @param bool   $protect Protect mode.
	 * @return bool See check().
	 */
	private static function judge_spoof( $ip, array $info, $protect ) {
		$key   = 'zbst_spoof_' . md5( $ip );
		$event = null;
		if ( ! get_transient( $key ) ) {
			set_transient( $key, 1, self::SPOOF_LOG_SECONDS );
			$event = array(
				'type'     => 'agent_spoof',
				'severity' => Log::SEVERITY_HIGH,
				'rule'     => $info['id'],
				'action'   => $protect ? 'blocked' : 'logged',
				'details'  => self::details( $info ),
			);
		}
		$handled = self::log( $event );
		if ( $protect ) {
			Guard::deny( 403, 'This request names a crawler but does not come from that crawler\'s network.' );
		}
		return $handled;
	}

	/**
	 * A verified agent: identity is settled, behaviour is judged separately.
	 *
	 * @param string $ip      Address.
	 * @param array  $info    From identify().
	 * @param bool   $protect Protect mode.
	 * @return bool See check().
	 */
	private static function judge_verified( $ip, array $info, $protect ) {
		$path   = self::path();
		$reason = '';
		if ( 'POST' === Request::method() && preg_match( '#/(?:wp-login|xmlrpc)\.php$#i', $path ) ) {
			$reason = 'login';
		} elseif ( preg_match( '#/wp-admin(?:/|$)#i', $path ) && ! preg_match( '#/admin-ajax\.php$#i', $path ) ) {
			// admin-ajax.php is left out: pages call it while a crawler renders them.
			$reason = 'wp-admin';
		}
		$write   = '' !== $reason;
		$ceiling = (int) Settings::get( 'agent_crawl_ceiling' );
		if ( $ceiling > 0 ) {
			$count = Guard::bump( 'ag' . $ip, 60 );
			if ( $count > $ceiling && '' === $reason ) {
				$reason = 'ceiling';
				// One event per flood, not one per request.
				$write = $count === $ceiling + 1;
			}
		}
		if ( '' === $reason ) {
			return false;
		}
		// robots.txt is always served to a verified agent.
		$deny    = $protect && ! self::is_robots();
		$handled = self::log(
			$write ? array(
				'type'     => 'agent_abuse',
				'severity' => Log::SEVERITY_MEDIUM,
				'rule'     => $info['id'],
				'action'   => $deny ? 'blocked' : 'logged',
				'details'  => self::details( $info, 'reason=' . $reason . ( 'ceiling' === $reason ? ' limit=' . $ceiling : '' ) ),
			) : null
		);
		if ( $deny && 'ceiling' === $reason ) {
			Guard::deny( 429, 'Too many requests. Please wait a minute and try again.' );
		}
		if ( $deny ) {
			Guard::deny( 403, 'This part of the site is not open to crawlers.' );
		}
		return $handled;
	}

	/**
	 * A request for the trap URL, or one that carries the fake key.
	 *
	 * @param string $trap    url or key.
	 * @param array  $info    From identify().
	 * @param bool   $protect Protect mode.
	 * @return bool See check().
	 */
	private static function judge_trap( $trap, array $info, $protect ) {
		// Browsers and WordPress fetch links ahead of a click; that is not a visit.
		if ( self::is_prefetch() ) {
			if ( 'url' === $trap ) {
				self::not_found();
			}
			return false;
		}
		// Fetchers that act for a person may ignore robots.txt by design: logged, never scored.
		$fetcher = $info['fetcher'] && 'spoofed' !== $info['verdict'];
		$deny    = $protect && ! $fetcher;
		$handled = self::log(
			array(
				'type'     => 'agent_trap',
				'severity' => $fetcher ? Log::SEVERITY_LOW : Log::SEVERITY_CRITICAL,
				'rule'     => '' !== $info['id'] ? $info['id'] : 'trap-' . $trap,
				'action'   => $deny ? 'blocked' : 'logged',
				'details'  => self::details( $info, 'trap=' . $trap ),
			)
		);
		if ( $deny ) {
			Guard::deny( 403, 'This request was blocked by the site firewall.' );
		}
		if ( 'url' === $trap ) {
			self::not_found();
		}
		return $handled;
	}

	/**
	 * Whether the browser says this request is a prefetch or prerender.
	 *
	 * @return bool
	 */
	private static function is_prefetch() {
		foreach ( array( 'HTTP_SEC_PURPOSE', 'HTTP_PURPOSE', 'HTTP_X_PURPOSE', 'HTTP_X_MOZ' ) as $header ) {
			// phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- compared against fixed words only.
			$value = isset( $_SERVER[ $header ] ) ? strtolower( (string) $_SERVER[ $header ] ) : '';
			if ( false !== strpos( $value, 'prefetch' ) || false !== strpos( $value, 'prerender' ) || false !== strpos( $value, 'preview' ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Answer the trap URL with a plain 404 that is never cached, and stop.
	 */
	private static function not_found() {
		do_action( 'zbst_deny', 404, 'Not found' );
		if ( ! headers_sent() ) {
			status_header( 404 );
			nocache_headers();
			header( 'Content-Type: text/plain; charset=utf-8' );
			header( 'X-Robots-Tag: noindex' );
		}
		echo 'Not found';
		exit;
	}

	// ---------------------------------------------------------------------------------------------
	// Traps.
	// ---------------------------------------------------------------------------------------------

	/**
	 * Whether the traps are switched on.
	 *
	 * @return bool
	 */
	public static function traps_on() {
		return 'off' !== Settings::get( 'agent_mode' ) && (bool) Settings::get( 'agent_traps' );
	}

	/**
	 * The trap path and fake key, created the first time they are needed.
	 *
	 * @return array Keys: path (like /zbst-0123456789ab), key, created.
	 */
	public static function traps() {
		$traps = get_option( self::TRAPS_OPTION );
		if ( is_array( $traps ) && isset( $traps['path'], $traps['key'] ) && preg_match( '#^/zbst-[0-9a-f]{12}$#', (string) $traps['path'] ) && preg_match( '/^zbst_live_[0-9a-f]{24}$/', (string) $traps['key'] ) ) {
			return $traps;
		}
		return self::regenerate_traps();
	}

	/**
	 * Replace the trap path and the fake key with new random ones.
	 *
	 * @return array See traps().
	 */
	public static function regenerate_traps() {
		$traps = array(
			'path'    => '/zbst-' . self::random_hex( 12 ),
			'key'     => 'zbst_live_' . self::random_hex( 24 ),
			'created' => time(),
		);
		update_option( self::TRAPS_OPTION, $traps, true );
		return $traps;
	}

	/**
	 * Random hexadecimal digits.
	 *
	 * @param int $length Number of digits (even).
	 * @return string
	 */
	private static function random_hex( $length ) {
		try {
			return bin2hex( random_bytes( (int) ( $length / 2 ) ) );
		} catch ( \Exception $e ) {
			// No secure source of randomness: the traps are bait, not secrets, so a weaker one will do.
			return substr( md5( uniqid( (string) mt_rand(), true ) ) . md5( uniqid( (string) mt_rand(), true ) ), 0, $length );
		}
	}

	/**
	 * Which trap the current request sprang, if any.
	 *
	 * @return string url, key or an empty string.
	 */
	private static function trap_hit() {
		if ( ! Settings::get( 'agent_traps' ) ) {
			return '';
		}
		$traps = self::traps();
		if ( false !== strpos( strtolower( self::path() ) . '/', $traps['path'] . '/' ) ) {
			return 'url';
		}
		// The key in the address, the query, a form, a JSON body, the cookies or the Authorization header.
		$request = Firewall::current_request();
		$values  = array_merge( array( $request['uri'], rawurldecode( $request['uri'] ) ), $request['args'], $request['cookies'] );
		foreach ( array( 'HTTP_AUTHORIZATION', 'REDIRECT_HTTP_AUTHORIZATION', 'HTTP_X_API_KEY' ) as $header ) {
			if ( isset( $_SERVER[ $header ] ) ) {
				$values[] = (string) $_SERVER[ $header ]; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput -- searched for a fixed string only.
			}
		}
		foreach ( $values as $value ) {
			if ( false !== strpos( $value, $traps['key'] ) ) {
				return 'key';
			}
		}
		return '';
	}

	/**
	 * The trap path as a visitor's browser sees it, including the folder WordPress lives in.
	 *
	 * @return string Like /zbst-0123456789ab/.
	 */
	private static function public_trap_path() {
		$base = (string) wp_parse_url( home_url( '/' ), PHP_URL_PATH );
		return rtrim( $base, '/' ) . self::traps()['path'] . '/';
	}

	/**
	 * Tell rule-following crawlers to keep out of the trap, so only those that ignore the rules
	 * walk into it.
	 *
	 * @param string $output robots.txt so far.
	 * @return string
	 */
	public static function robots_txt( $output ) {
		if ( ! self::traps_on() ) {
			return $output;
		}
		// A group of its own, so the line counts wherever the text before it ended.
		return rtrim( (string) $output ) . "\n\nUser-agent: *\nDisallow: " . self::public_trap_path() . "\n";
	}

	/**
	 * The hidden link to the trap. People never see or reach it: it is not displayed, screen
	 * readers and the Tab key skip it, and browsers are told not to fetch it ahead of time.
	 */
	public static function footer_link() {
		if ( ! self::traps_on() ) {
			return;
		}
		echo '<a href="' . esc_url( home_url( self::traps()['path'] . '/' ) ) . '" rel="nofollow" aria-hidden="true" tabindex="-1" class="no-prefetch" style="display:none">Archive</a>' . "\n";
	}

	/**
	 * The fake key, in a comment that reads like a credential left behind by mistake.
	 */
	public static function head_comment() {
		if ( ! self::traps_on() ) {
			return;
		}
		echo '<!-- TODO remove before launch: api_key=' . esc_html( self::traps()['key'] ) . " -->\n";
	}

	/**
	 * Keep WordPress's speculative loading away from the trap.
	 *
	 * @param array $paths Paths not loaded ahead of a click.
	 * @return array
	 */
	public static function exclude_paths( $paths ) {
		if ( is_array( $paths ) && self::traps_on() ) {
			$paths[] = self::traps()['path'] . '/*';
		}
		return $paths;
	}

	// ---------------------------------------------------------------------------------------------
	// Address lists.
	// ---------------------------------------------------------------------------------------------

	/**
	 * Read a vendor's list. Every vendor uses the same shape: creationTime plus prefixes, each
	 * with an ipv4Prefix or an ipv6Prefix.
	 *
	 * @param string $body JSON.
	 * @return array|null Keys creation_time and prefixes (canonical CIDR strings), or null when
	 *                    the text is not a list with at least one valid prefix.
	 */
	public static function parse_list( $body ) {
		$data = json_decode( (string) $body, true );
		if ( ! is_array( $data ) || ! isset( $data['prefixes'] ) || ! is_array( $data['prefixes'] ) ) {
			return null;
		}
		$prefixes = array();
		foreach ( $data['prefixes'] as $entry ) {
			foreach ( array( 'ipv4Prefix', 'ipv6Prefix' ) as $field ) {
				if ( ! is_array( $entry ) || ! isset( $entry[ $field ] ) || ! is_string( $entry[ $field ] ) ) {
					continue;
				}
				$range = IP::parse_range( $entry[ $field ] );
				// A range as wide as a tenth of the internet is a mistake, not a crawler's network.
				if ( $range && $range['prefix'] >= ( 4 === strlen( $range['bin'] ) ? 8 : 16 ) ) {
					$prefixes[ $range['canonical'] ] = true;
				}
			}
			if ( count( $prefixes ) >= self::MAX_PREFIXES ) {
				break;
			}
		}
		if ( ! $prefixes ) {
			return null;
		}
		return array(
			'creation_time' => Request::clip( isset( $data['creationTime'] ) && is_string( $data['creationTime'] ) ? $data['creationTime'] : '', 40 ),
			'prefixes'      => array_map( 'strval', array_keys( $prefixes ) ),
		);
	}

	/**
	 * Fetch one list.
	 *
	 * @param string $url Address of the list.
	 * @return array|string Parsed list, or what went wrong.
	 */
	private static function fetch( $url ) {
		$response = wp_remote_get(
			$url,
			array(
				'timeout'             => 10,
				'redirection'         => 3,
				'limit_response_size' => self::MAX_BYTES,
				'user-agent'          => 'ZenZeiTen-Bastion/' . ZBST_VERSION,
				'headers'             => array( 'Accept' => 'application/json' ),
			)
		);
		if ( is_wp_error( $response ) ) {
			return 'no answer: ' . $response->get_error_message();
		}
		$code = (int) wp_remote_retrieve_response_code( $response );
		if ( 200 !== $code ) {
			return 'HTTP ' . $code;
		}
		$list = self::parse_list( wp_remote_retrieve_body( $response ) );
		return $list ? $list : 'HTTP 200, but not a list of prefixes';
	}

	/**
	 * Fetch every list. A list that cannot be fetched or read keeps its previous copy, which then
	 * ages out after three days; the failure is logged.
	 *
	 * @return array One row per agent: id, ok, prefixes, error.
	 */
	public static function refresh() {
		$stored  = get_option( self::LISTS_OPTION, array() );
		$stored  = is_array( $stored ) ? $stored : array();
		$lists   = array();
		$results = array();
		foreach ( self::registry() as $id => $agent ) {
			if ( ! $agent['urls'] ) {
				continue;
			}
			$prefixes = array();
			$created  = '';
			$error    = '';
			foreach ( $agent['urls'] as $url ) {
				$list = self::fetch( $url );
				if ( ! is_array( $list ) ) {
					$error = $url . ' (' . $list . ')';
					break;
				}
				$prefixes = array_merge( $prefixes, $list['prefixes'] );
				$created  = '' !== $created ? $created : $list['creation_time'];
			}
			$old = isset( $stored[ $id ] ) && is_array( $stored[ $id ] ) ? $stored[ $id ] : array();
			if ( '' === $error ) {
				$prefixes     = array_values( array_unique( $prefixes ) );
				$lists[ $id ] = array(
					'urls'          => $agent['urls'],
					'fetched_at'    => time(),
					'creation_time' => $created,
					'count'         => count( $prefixes ),
					'prefixes'      => $prefixes,
					'error'         => '',
				);
			} else {
				$lists[ $id ] = array_merge(
					array(
						'urls'          => $agent['urls'],
						'fetched_at'    => 0,
						'creation_time' => '',
						'count'         => 0,
						'prefixes'      => array(),
					),
					$old,
					array( 'error' => Request::clip( $error, 200 ) )
				);
				Log::add(
					array(
						'type'       => 'agent_list',
						'severity'   => Log::SEVERITY_LOW,
						'score'      => 0,
						'rule'       => $id,
						'ip'         => '',
						'method'     => '',
						'uri'        => '',
						'user_agent' => '',
						'details'    => 'List not refreshed: ' . $error,
					)
				);
			}
			$results[] = array(
				'id'       => $id,
				'ok'       => '' === $error,
				'prefixes' => (int) $lists[ $id ]['count'],
				'error'    => $error,
			);
		}
		update_option( self::LISTS_OPTION, $lists, false );
		self::reset();
		return $results;
	}

	/**
	 * The daily cron job. It makes no requests while the module is off.
	 */
	public static function cron_refresh() {
		if ( 'off' !== Settings::get( 'agent_mode' ) ) {
			self::refresh();
		}
	}

	/**
	 * Every registry entry with the state of its list, for the settings screen and WP-CLI.
	 *
	 * Status: fresh (fetched in the last three days), stale (older, or never fetched), failed
	 * (the latest attempt failed) or none (the vendor publishes no list).
	 *
	 * @return array Rows: id, agent, vendor, kind, prefixes, fetched_at, age_days, status, error.
	 */
	public static function status() {
		$lists = self::lists();
		$rows  = array();
		foreach ( self::registry() as $id => $agent ) {
			$list    = isset( $lists[ $id ] ) && is_array( $lists[ $id ] ) ? $lists[ $id ] : array();
			$fetched = isset( $list['fetched_at'] ) ? (int) $list['fetched_at'] : 0;
			$error   = isset( $list['error'] ) ? (string) $list['error'] : '';
			if ( ! $agent['urls'] ) {
				$status = 'none';
			} elseif ( '' !== $error ) {
				$status = 'failed';
			} elseif ( $fetched && time() - $fetched <= self::FRESH_SECONDS ) {
				$status = 'fresh';
			} else {
				$status = 'stale';
			}
			$rows[] = array(
				'id'         => $id,
				'agent'      => implode( ', ', $agent['tokens'] ),
				'vendor'     => $agent['vendor'],
				'kind'       => $agent['kind'],
				'prefixes'   => isset( $list['count'] ) ? (int) $list['count'] : 0,
				'fetched_at' => $fetched,
				'age_days'   => $fetched ? (int) floor( max( 0, time() - $fetched ) / DAY_IN_SECONDS ) : null,
				'status'     => $status,
				'error'      => $error,
			);
		}
		return $rows;
	}
}
