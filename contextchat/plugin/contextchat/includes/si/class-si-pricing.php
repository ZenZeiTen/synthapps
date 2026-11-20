<?php
/**
 * What a Claude API call costs, for the daily spending cap.
 *
 * Pure PHP with no WordPress calls, so it can be unit tested on its own.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Model prices and cost calculation.
 */
class ContextChat_SI_Pricing {

	/**
	 * US dollars per million tokens, from Anthropic's model table (checked 20 Nov 2026).
	 * Cache writes are billed at 1.25 times the input price (5-minute cache). Claude Haiku 5.5
	 * costs more when a prompt is longer than 100,000 tokens.
	 *
	 * Sites can correct or extend this with the `contextchat_si_prices` filter. A model missing
	 * from the table is priced like the most expensive one listed, so the cap is never too lax.
	 *
	 * @return array<string, array<string, float|int>>
	 */
	public static function table() {
		return array(
			'claude-haiku-5-5'  => array(
				'input'          => 0.10,
				'output'         => 0.50,
				'cache_read'     => 0.01,
				'long_threshold' => 100000,
				'long_input'     => 0.50,
				'long_output'    => 2.50,
			),
			'claude-sonnet-5-5' => array(
				'input'      => 2.00,
				'output'     => 10.00,
				'cache_read' => 0.10,
			),
			'claude-opus-5-5'   => array(
				'input'      => 4.00,
				'output'     => 20.00,
				'cache_read' => 0.20,
			),
			'claude-fable-5-2'  => array(
				'input'      => 8.00,
				'output'     => 40.00,
				'cache_read' => 0.20,
			),
		);
	}

	/**
	 * Cost of one response in micro-dollars (1 USD = 1,000,000), rounded up.
	 *
	 * A price of N dollars per million tokens is exactly N micro-dollars per token.
	 *
	 * @param string $model  Model that served the response.
	 * @param array  $usage  The response's `usage` object.
	 * @param array  $prices Price table, as from table().
	 * @return int
	 */
	public static function cost_micro_usd( $model, array $usage, array $prices ) {
		$price = self::price_for( $model, $prices );
		if ( ! $price ) {
			return 0;
		}

		$input       = self::count( $usage, 'input_tokens' );
		$output      = self::count( $usage, 'output_tokens' );
		$cache_read  = self::count( $usage, 'cache_read_input_tokens' );
		$cache_write = self::count( $usage, 'cache_creation_input_tokens' );

		$in_rate  = (float) $price['input'];
		$out_rate = (float) $price['output'];
		if ( ! empty( $price['long_threshold'] ) && $input + $cache_read + $cache_write > (int) $price['long_threshold'] ) {
			$in_rate  = (float) $price['long_input'];
			$out_rate = (float) $price['long_output'];
		}
		$read_rate = isset( $price['cache_read'] ) ? (float) $price['cache_read'] : $in_rate * 0.1;

		$cost = $input * $in_rate + $output * $out_rate + $cache_read * $read_rate + $cache_write * $in_rate * 1.25;
		return (int) ceil( $cost - 1e-9 );
	}

	/**
	 * Price entry for a model, or the most expensive entry for an unknown model.
	 *
	 * @param string $model  Model ID.
	 * @param array  $prices Price table.
	 * @return array|null
	 */
	public static function price_for( $model, array $prices ) {
		if ( isset( $prices[ $model ] ) ) {
			return $prices[ $model ];
		}
		$top = null;
		foreach ( $prices as $price ) {
			if ( null === $top || $price['output'] > $top['output'] ) {
				$top = $price;
			}
		}
		return $top;
	}

	/**
	 * A token count from a usage object, never negative.
	 *
	 * @param array  $usage Usage.
	 * @param string $key   Field.
	 * @return int
	 */
	private static function count( array $usage, $key ) {
		return isset( $usage[ $key ] ) ? max( 0, (int) $usage[ $key ] ) : 0;
	}
}
