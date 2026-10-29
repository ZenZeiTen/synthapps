<?php
/**
 * The interface every AI provider implements.
 *
 * @package ZenZeiTen\FormaToolkit
 */

namespace ZenZeiTen\FormaToolkit;

defined( 'ABSPATH' ) || exit;

/**
 * An AI text provider. The toolkit ships a Claude provider; other providers can be plugged in
 * through the zzft_ai_provider filter.
 */
interface Provider {

	/**
	 * Generate a reply.
	 *
	 * @param array $request {
	 *     @type string $model      Model id.
	 *     @type string $system     System prompt.
	 *     @type array  $messages   List of array( 'role' => 'user'|'assistant', 'content' => string ).
	 *     @type int    $max_tokens Output token ceiling.
	 *     @type string $effort     'low', 'medium' or 'high'.
	 * }
	 * @return array|\WP_Error array( 'text' => string, 'model' => string, 'stop_reason' => string, 'usage' => array( 'input' => int, 'output' => int ) ).
	 */
	public function complete( array $request );
}
