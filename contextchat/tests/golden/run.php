<?php
/**
 * Golden conversations for the SI chat (design plan T-13).
 *
 * Dry run (default, no network, part of `npm test`):
 *   php tests/golden/run.php
 * Checks the file, the expected estimates against the price engine, and every turn that is answered
 * without the model (refused messages and fixed replies).
 *
 * Live run (real Anthropic API, costs money, never in CI):
 *   ANTHROPIC_API_KEY=... php tests/golden/run.php --live [--only=g01,g02] [--no-grade] [--max-cost=2.00] [--out=dir]
 * Plays every conversation through the orchestrator with the bundled knowledge, voice and prices,
 * checks each reply, then asks Claude Haiku to grade the tone against the voice guide. Writes
 * results.json and report.md to tests/golden/results/<time>/ (ignored by git).
 */

define( 'ABSPATH', __DIR__ . '/' );
define( 'CONTEXTCHAT_VERSION', 'golden' );

$plugin = dirname( __DIR__, 2 ) . '/plugin/contextchat';
foreach ( array( 'si/class-si-pricing', 'si/class-si-router', 'si/class-si-client', 'si/class-countries', 'si/class-price-engine', 'si/class-guard', 'si/class-validator', 'si/class-knowledge', 'si/class-voice', 'si/class-prompt', 'si/class-handoff', 'si/class-orchestrator' ) as $file ) {
	require $plugin . '/includes/' . $file . '.php';
}
if ( ! function_exists( 'apply_filters' ) ) {
	function apply_filters( $hook, $value ) {
		return $value;
	}
}

$opts = array(
	'live'     => false,
	'grade'    => true,
	'only'     => array(),
	'max_cost' => 2.0,
	'out'      => '',
);
foreach ( array_slice( $argv, 1 ) as $arg ) {
	if ( '--live' === $arg ) {
		$opts['live'] = true;
	} elseif ( '--no-grade' === $arg ) {
		$opts['grade'] = false;
	} elseif ( 0 === strpos( $arg, '--only=' ) ) {
		$opts['only'] = array_filter( explode( ',', substr( $arg, 7 ) ) );
	} elseif ( 0 === strpos( $arg, '--max-cost=' ) ) {
		$opts['max_cost'] = (float) substr( $arg, 11 );
	} elseif ( 0 === strpos( $arg, '--out=' ) ) {
		$opts['out'] = substr( $arg, 6 );
	} else {
		fwrite( STDERR, "Unknown option {$arg}\n" );
		exit( 2 );
	}
}

/** Model used to grade the tone. */
const GRADER_MODEL = 'claude-haiku-5-5';
/** Lowest passing tone score (1–5). */
const PASS_SCORE = 4;
/** Words a reply never uses (the voice guide calls it SI). */
const NEVER = array( '/\bAI\b/', '/\bchatbot\b/i', '/\bbot\b/i' );

/**
 * The Messages API over curl, with the same result shape as ContextChat_SI_Client.
 */
class Golden_Client {
	private $key;
	public $calls = 0;
	public function __construct( $key ) {
		$this->key = $key;
	}
	public function send( array $body, array $betas = array() ) {
		++$this->calls;
		$headers = array( 'content-type: application/json', 'x-api-key: ' . $this->key, 'anthropic-version: ' . ContextChat_SI_Client::API_VERSION );
		if ( $betas ) {
			$headers[] = 'anthropic-beta: ' . implode( ',', $betas );
		}
		// GOLDEN_API_URL points the runner at a stand-in server, to test the runner itself.
		$ch = curl_init( getenv( 'GOLDEN_API_URL' ) ? getenv( 'GOLDEN_API_URL' ) : ContextChat_SI_Client::API_URL );
		curl_setopt_array( $ch, array( CURLOPT_POST => true, CURLOPT_HTTPHEADER => $headers, CURLOPT_POSTFIELDS => json_encode( $body ), CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 120, CURLOPT_HEADER => true ) );
		$raw = curl_exec( $ch );
		if ( false === $raw ) {
			return array( 'status' => 0, 'data' => array(), 'error_type' => 'transport_error', 'error_code' => (string) curl_errno( $ch ), 'retry_after' => 0 );
		}
		$status = (int) curl_getinfo( $ch, CURLINFO_RESPONSE_CODE );
		$hsize  = (int) curl_getinfo( $ch, CURLINFO_HEADER_SIZE );
		$retry  = preg_match( '/^retry-after:\s*(\d+)/mi', substr( $raw, 0, $hsize ), $m ) ? (int) $m[1] : 0;
		$data   = json_decode( substr( $raw, $hsize ), true );
		$data   = is_array( $data ) ? $data : array();
		$err    = isset( $data['error'] ) && is_array( $data['error'] ) ? $data['error'] : array();
		return array( 'status' => $status, 'data' => $data, 'error_type' => isset( $err['type'] ) ? (string) $err['type'] : '', 'error_code' => '', 'retry_after' => $retry );
	}
}

/** A client that must not be called (dry run). */
class No_Network_Client {
	public $calls = 0;
	public function send( array $body, array $betas = array() ) {
		++$this->calls;
		return array( 'status' => 0, 'data' => array(), 'error_type' => 'transport_error', 'error_code' => 'dry_run', 'retry_after' => 0 );
	}
}

/** Spend meter without a daily cap. */
class Golden_Meter {
	public $spent = 0;
	public function spent_today() {
		return 0;
	}
	public function add( $m ) {
		$this->spent += $m;
	}
}

/** In-memory chat store. */
class Golden_Store {
	public $messages = array();
	public $quotes   = array();
	public $events   = array();
	public function add_message( $id, $role, $content, $model ) {
		$this->messages[] = array( 'role' => $role, 'content' => $content, 'model' => $model, 'created_at' => gmdate( 'Y-m-d H:i:s' ) );
	}
	public function recent_messages( $id, $limit ) {
		return array_slice( $this->messages, -$limit );
	}
	public function add_quote( $id, array $result, array $input ) {
		$this->quotes[] = array( $result, $input );
	}
	public function add_event( $id, $type, $detail ) {
		$this->events[] = $type . ( '' !== $detail ? ':' . $detail : '' );
	}
	public function update_conversation( $id, array $fields ) {}
}

$file = json_decode( (string) file_get_contents( __DIR__ . '/conversations.json' ), true );
if ( ! is_array( $file ) || empty( $file['conversations'] ) ) {
	fwrite( STDERR, "conversations.json is not valid JSON.\n" );
	exit( 1 );
}
$today     = gmdate( 'Y-m-d' );
$engine    = new ContextChat_Price_Engine( ContextChat_Price_Engine::seed(), new ContextChat_Countries() );
$voice     = ContextChat_Voice::defaults();
$knowledge = ContextChat_Knowledge::seed();
$prefix    = ContextChat_Prompt::prefix( $voice, $knowledge, ContextChat_Price_Engine::seed(), array( 'name' => 'Nusalexia' ) );
$prices    = ContextChat_SI_Pricing::table();
$key       = (string) getenv( 'ANTHROPIC_API_KEY' );

if ( $opts['live'] && '' === $key ) {
	fwrite( STDERR, "--live needs ANTHROPIC_API_KEY in the environment.\n" );
	exit( 2 );
}

/**
 * The expected total for a price-engine input, or the engine's status when it is not ok.
 */
$expected_quote = function ( array $spec, $lang ) use ( $engine, $today ) {
	return $engine->quote( $spec, $today, $lang );
};

/**
 * One orchestrator for one conversation.
 */
$make = function ( $client, $meter, $store ) use ( $engine, $prefix, $voice, $knowledge, $today ) {
	$router = new ContextChat_SI_Router( $client, array(), $meter, function ( $s ) {
		sleep( min( 30, max( 1, (int) $s ) ) );
	} );
	return new ContextChat_Orchestrator( $store, $router, $engine, array(
		'prefix'    => $prefix,
		'voice'     => $voice,
		'knowledge' => $knowledge,
		'site_host' => 'www.nusalexia.co.id',
		'email'     => 'info@nusalexia.co.id',
		'today'     => $today,
	) );
};

$problems = array();
$results  = array();
$cost     = 0;
$ids      = array();

foreach ( $file['conversations'] as $c ) {
	$id = isset( $c['id'] ) ? (string) $c['id'] : '';
	if ( '' === $id || isset( $ids[ $id ] ) || empty( $c['turns'] ) || ! in_array( isset( $c['lang'] ) ? $c['lang'] : '', array( 'id', 'en' ), true ) ) {
		$problems[] = "{$id}: needs a unique id, lang id or en, and turns";
		continue;
	}
	$ids[ $id ] = true;
	if ( $opts['only'] && ! in_array( $id, $opts['only'], true ) ) {
		continue;
	}

	$fail  = function ( $turn, $msg ) use ( &$problems, $id ) {
		$problems[] = "{$id} turn {$turn}: {$msg}";
	};
	$store = new Golden_Store();
	$meter = new Golden_Meter();
	$net   = $opts['live'] ? new Golden_Client( $key ) : new No_Network_Client();
	$orch  = $make( $net, $meter, $store );
	$conv  = array( 'id' => '01GOLDEN0000000000000000' . sprintf( '%02d', count( $ids ) ), 'reference' => 'CC-GOLDEN-' . $id, 'state' => ContextChat_Orchestrator::new_state( $c['lang'], 'https://www.nusalexia.co.id' . ( isset( $c['page'] ) ? $c['page'] : '/' ) ) );
	$log   = array();

	foreach ( $c['turns'] as $n => $turn ) {
		$t      = $n + 1;
		$expect = isset( $turn['expect'] ) && is_array( $turn['expect'] ) ? $turn['expect'] : array();
		$text   = (string) $turn['visitor'];
		foreach ( array_merge( isset( $expect['reply_matches'] ) ? $expect['reply_matches'] : array(), isset( $expect['reply_not'] ) ? $expect['reply_not'] : array() ) as $re ) {
			if ( false === @preg_match( '/' . str_replace( '/', '\/', $re ) . '/iu', '' ) ) { // phpcs:ignore WordPress.PHP.NoSilencedErrors
				$fail( $t, "bad pattern {$re}" );
			}
		}
		if ( isset( $expect['quote'] ) ) {
			$q = $expected_quote( $expect['quote'], $c['lang'] );
			if ( ! in_array( $q['status'], array( 'ok', 'needs_team' ), true ) ) {
				$fail( $t, 'the expected estimate is not computable: ' . $q['status'] );
			}
		}
		if ( isset( $expect['quote_status'] ) ) {
			$q = $expected_quote( $expect['quote_status']['spec'], $c['lang'] );
			if ( $q['status'] !== $expect['quote_status']['status'] ) {
				$fail( $t, "the price engine says {$q['status']}, expected {$expect['quote_status']['status']}" );
			}
		}

		// The guard runs first, as in the REST endpoint.
		$verdict = ContextChat_Guard::inspect( $text, ContextChat_Guard::FILE_HOSTS );
		if ( isset( $expect['blocked'] ) || ! $verdict['ok'] ) {
			$got = $verdict['ok'] ? '' : $verdict['block'];
			if ( ( isset( $expect['blocked'] ) ? $expect['blocked'] : '' ) !== $got ) {
				$fail( $t, 'guard: expected ' . ( isset( $expect['blocked'] ) ? $expect['blocked'] : 'no block' ) . ", got {$got}" );
			}
			$log[] = array( 'visitor' => $text, 'reply' => '(refused by the guard: ' . $got . ')' );
			continue;
		}

		$before = $net->calls;
		if ( ! $opts['live'] && empty( $expect['fixed'] ) ) {
			// Needs the model: nothing more to check without the network.
			$log[] = array( 'visitor' => $text, 'reply' => '(dry run)' );
			continue;
		}
		$out           = $orch->turn( $conv, $text );
		$conv['state'] = $out['state'];
		$reply         = (string) $out['reply'];
		$log[]         = array( 'visitor' => $text, 'reply' => $reply, 'model' => $out['model'], 'quote' => $out['quote'] ? $out['quote']['total'] : null, 'handoff' => $out['handoff'] );
		$cost         += (int) $out['cost_micro_usd'];

		if ( ! empty( $expect['fixed'] ) && $net->calls !== $before ) {
			$fail( $t, 'expected a fixed reply without the model, but the model was called' );
		}
		if ( '' === trim( $reply ) ) {
			$fail( $t, 'empty reply' );
		}
		foreach ( NEVER as $re ) {
			if ( preg_match( $re, $reply ) ) {
				$fail( $t, "reply uses a word the voice never uses ({$re})" );
			}
		}
		if ( isset( $expect['lang'] ) && $out['lang'] !== $expect['lang'] ) {
			$fail( $t, "language {$out['lang']}, expected {$expect['lang']}" );
		}
		if ( isset( $expect['quote'] ) ) {
			$want = $expected_quote( $expect['quote'], $c['lang'] );
			$got  = $out['quote'] ? (int) $out['quote']['total'] : null;
			if ( $got !== (int) $want['total'] ) {
				$fail( $t, 'estimate ' . var_export( $got, true ) . ", expected {$want['total']}" );
			}
		}
		if ( ! empty( $expect['no_quote'] ) && $out['quote'] ) {
			$fail( $t, 'gave an estimate where none was expected' );
		}
		if ( array_key_exists( 'handoff', $expect ) && (string) $out['handoff'] !== (string) $expect['handoff'] ) {
			$fail( $t, 'handoff "' . $out['handoff'] . '", expected "' . $expect['handoff'] . '"' );
		}
		foreach ( isset( $expect['reply_matches'] ) ? $expect['reply_matches'] : array() as $re ) {
			if ( ! preg_match( '/' . str_replace( '/', '\/', $re ) . '/iu', $reply ) ) {
				$fail( $t, "reply does not match {$re}" );
			}
		}
		foreach ( isset( $expect['reply_not'] ) ? $expect['reply_not'] : array() as $re ) {
			if ( preg_match( '/' . str_replace( '/', '\/', $re ) . '/iu', $reply ) ) {
				$fail( $t, "reply matches {$re}" );
			}
		}
	}

	$grade = null;
	$spoke = array_filter(
		$log,
		function ( $l ) {
			return ! empty( $l['model'] );
		}
	);
	if ( $opts['live'] && $opts['grade'] && $spoke ) {
		$grade = grade( $net, $voice, $c, $log, $prices, $cost );
		if ( $grade && $grade['score'] < PASS_SCORE ) {
			$problems[] = "{$id}: tone score {$grade['score']} (" . implode( '; ', $grade['issues'] ) . ')';
		}
	}
	$results[] = array( 'id' => $id, 'lang' => $c['lang'], 'log' => $log, 'grade' => $grade );
	if ( $opts['live'] ) {
		printf( "%-34s %s\n", $id, $grade ? 'tone ' . $grade['score'] . '/5' : 'done' );
		if ( $cost / 1000000 > $opts['max_cost'] ) {
			$problems[] = sprintf( 'stopped: spent $%.4f, over --max-cost', $cost / 1000000 );
			break;
		}
	}
}

/**
 * Ask Haiku to grade one conversation's tone against the voice guide. Returns score, issues, summary.
 */
function grade( $client, array $voice, array $c, array $log, array $prices, &$cost ) {
	$transcript = '';
	foreach ( $log as $i => $l ) {
		$transcript .= 'Visitor ' . ( $i + 1 ) . ': ' . $l['visitor'] . "\nAssistant " . ( $i + 1 ) . ': ' . $l['reply'] . "\n\n";
	}
	$guide = $voice['guide'][ 'en' === $c['lang'] ? 'en' : 'id' ];
	$body  = array(
		'model'       => GRADER_MODEL,
		'max_tokens'  => 1024,
		'system'      => "You review a translation agency's website chat assistant (called the SI assistant) against its voice guide. Judge only tone and conduct: warmth, brevity, plain language, the register of the guide, honesty (no promises the business cannot keep, no invented facts or prices), and handing over to the team when the guide says so. Do not judge prices: they are calculated by code. Replies in parentheses were made by the system without the assistant and are not graded.\n\nVoice guide:\n" . $guide,
		'messages'    => array(
			array(
				'role'    => 'user',
				'content' => "What this conversation should feel like: " . ( isset( $c['tone'] ) ? $c['tone'] : '' ) . "\n\nTranscript:\n\n" . $transcript . 'Grade it with the grade tool.',
			),
		),
		'tools'       => array(
			array(
				'name'         => 'grade',
				'description'  => 'Record the tone grade for this conversation.',
				'input_schema' => array(
					'type'       => 'object',
					'properties' => array(
						'score'   => array( 'type' => 'integer', 'minimum' => 1, 'maximum' => 5, 'description' => '5 = exactly the voice guide; 4 = small issues; 3 = noticeable issues; 2 = wrong register or a dishonest claim; 1 = harmful or off-brand.' ),
						'issues'  => array( 'type' => 'array', 'items' => array( 'type' => 'string' ), 'description' => 'Specific problems, quoting the words. Empty when there are none.' ),
						'summary' => array( 'type' => 'string', 'description' => 'One sentence.' ),
					),
					'required'   => array( 'score', 'issues', 'summary' ),
				),
			),
		),
		'tool_choice' => array( 'type' => 'tool', 'name' => 'grade' ),
	);
	$r = $client->send( $body );
	if ( 200 !== $r['status'] ) {
		return array( 'score' => 0, 'issues' => array( 'grader request failed: HTTP ' . $r['status'] . ' ' . $r['error_type'] ), 'summary' => '' );
	}
	$cost += ContextChat_SI_Pricing::cost_micro_usd( GRADER_MODEL, isset( $r['data']['usage'] ) ? $r['data']['usage'] : array(), $prices );
	foreach ( isset( $r['data']['content'] ) ? $r['data']['content'] : array() as $block ) {
		if ( 'tool_use' === $block['type'] && 'grade' === $block['name'] && isset( $block['input']['score'] ) ) {
			return array(
				'score'   => (int) $block['input']['score'],
				'issues'  => array_values( array_map( 'strval', (array) ( isset( $block['input']['issues'] ) ? $block['input']['issues'] : array() ) ) ),
				'summary' => (string) ( isset( $block['input']['summary'] ) ? $block['input']['summary'] : '' ),
			);
		}
	}
	return array( 'score' => 0, 'issues' => array( 'the grader gave no grade' ), 'summary' => '' );
}

$count = count( $results );
if ( $opts['live'] ) {
	$dir = '' !== $opts['out'] ? $opts['out'] : __DIR__ . '/results/' . gmdate( 'Ymd-His' );
	if ( ! is_dir( $dir ) ) {
		mkdir( $dir, 0777, true );
	}
	file_put_contents( $dir . '/results.json', json_encode( array( 'date' => gmdate( 'c' ), 'cost_usd' => $cost / 1000000, 'problems' => $problems, 'conversations' => $results ), JSON_PRETTY_PRINT | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES ) );
	$md = "# Golden conversations, " . gmdate( 'Y-m-d H:i' ) . " UTC\n\n" . sprintf( "%d conversations, %d problems, cost about \$%.4f.\n\n", $count, count( $problems ), $cost / 1000000 );
	$md .= "| Conversation | Tone | Summary |\n|---|---|---|\n";
	foreach ( $results as $r ) {
		$md .= '| ' . $r['id'] . ' | ' . ( $r['grade'] ? $r['grade']['score'] . '/5' : '—' ) . ' | ' . str_replace( '|', '/', $r['grade'] ? $r['grade']['summary'] : '' ) . " |\n";
	}
	$md .= $problems ? "\n## Problems\n\n- " . implode( "\n- ", $problems ) . "\n" : "\nNo problems.\n";
	file_put_contents( $dir . '/report.md', $md );
	echo "\nReport: {$dir}/report.md\n";
}

foreach ( $problems as $p ) {
	echo "FAIL - {$p}\n";
}
printf( "golden: %d conversations %s, %d problems%s\n", $count, $opts['live'] ? 'played' : 'checked (dry run)', count( $problems ), $opts['live'] ? sprintf( ', about $%.4f', $cost / 1000000 ) : '' );
exit( $problems ? 1 : 0 );
