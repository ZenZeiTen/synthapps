<?php
/**
 * Suggested privacy policy text for the SI chat, offered in WordPress under Settings → Privacy →
 * Policy Guide. It is a starting point checked against UU 27/2022 and PP 33/2026, not legal advice:
 * the parts in square brackets are for the site owner and their legal review to fill in.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Privacy policy text.
 */
class ContextChat_Privacy {

	/**
	 * Hooks.
	 */
	public static function init() {
		add_action( 'admin_init', array( __CLASS__, 'add_policy_content' ) );
	}

	/**
	 * Offer the text in the Policy Guide.
	 */
	public static function add_policy_content() {
		if ( function_exists( 'wp_add_privacy_policy_content' ) ) {
			wp_add_privacy_policy_content( 'ContextChat', wp_kses_post( self::policy_html() ) );
		}
	}

	/**
	 * The suggested text as HTML, with the site's own settings filled in where they are known.
	 *
	 * @return string
	 */
	public static function policy_html() {
		$s       = ContextChat_Settings::get();
		$days    = ContextChat_Chat_REST::retention_days();
		$name    = ContextChat_Chat_REST::business_name();
		$email   = ContextChat_Chat_REST::handoff_email();
		$contact = '' !== $email ? $email : __( '[contact email]', 'contextchat' );
		$p       = function ( $text ) {
			return '<p>' . $text . '</p>';
		};
		$html  = '<p class="privacy-policy-tutorial">' . esc_html__( 'Suggested text for the SI chat of ContextChat. It was checked against Indonesia\'s Personal Data Protection Law (UU 27/2022) and its implementing regulation (PP 33/2026), but it is not legal advice. Fill in the parts in square brackets and have it reviewed before you publish it.', 'contextchat' ) . '</p>';
		$html .= '<h3>' . esc_html__( 'Chat with our SI assistant', 'contextchat' ) . '</h3>';
		$html .= $p(
			/* translators: 1: business name, 2: contact email. */
			esc_html( sprintf( __( 'The chat on this site is run by %1$s ([company address]). We decide how chat data is used and are responsible for it. Contact: %2$s.', 'contextchat' ), $name, $contact ) )
		);
		$html .= $p( '<strong>' . esc_html__( 'What we collect.', 'contextchat' ) . '</strong> ' . esc_html__( 'The messages you type; the details of your request that you give in them, such as document types, languages, number of pages, destination country and deadline; the estimates the chat gives you; the page address where you opened the chat (without anything after "?"), your language and whether you use a phone or a computer; and a chat reference number. We do not store your IP address: to stop misuse, messages are counted against a code that changes every day.', 'contextchat' ) );
		$html .= $p( esc_html__( 'Please do not send ID numbers, documents or links to file-sharing services in the chat. The chat refuses them, and such messages are neither stored nor sent to Anthropic. Send documents by WhatsApp or email instead.', 'contextchat' ) );
		$html .= $p( '<strong>' . esc_html__( 'Why.', 'contextchat' ) . '</strong> ' . esc_html__( 'To answer your questions about our services, to calculate estimates from our price list, and to prepare a summary for our team when you continue by WhatsApp or email.', 'contextchat' ) );
		$html .= $p( '<strong>' . esc_html__( 'Legal basis.', 'contextchat' ) . '</strong> ' . ( empty( $s['si_consent'] )
			? esc_html__( '[Choose after legal review: your request before entering into an agreement with us (UU 27/2022 Article 20(2)(b)), or our legitimate interest in answering enquiries (Article 20(2)(f)), with the assessment PP 33/2026 Articles 53 and 54 require.]', 'contextchat' )
			: esc_html__( 'Your explicit consent, given with the "Agree and start" button before the chat begins (UU 27/2022 Article 20(2)(a)). You can withdraw it at any time by writing to us; we then stop processing and delete the chat.', 'contextchat' ) ) );
		$html .= $p( '<strong>' . esc_html__( 'Processing by Anthropic, outside Indonesia.', 'contextchat' ) . '</strong> ' . esc_html__( 'To write the replies, your messages and the chat so far are sent to Anthropic, PBC, a language-model provider based in the United States, which processes them for us. According to Anthropic, it deletes API inputs and outputs within 30 days, unless longer retention is needed to enforce its usage policy or required by law. [Describe the safeguard for this transfer and its risks after legal review, as PP 33/2026 Articles 164 to 173 require, for example Anthropic\'s Data Processing Addendum with standard contractual clauses.]', 'contextchat' ) );
		$html .= $p(
			'<strong>' . esc_html__( 'How long.', 'contextchat' ) . '</strong> ' .
			/* translators: %d: number of days. */
			esc_html( sprintf( __( 'Each chat, with its estimates, is kept on this site for %d days from its start and then deleted automatically. We keep only a record that a deletion took place.', 'contextchat' ), $days ) )
		);
		$html .= $p(
			'<strong>' . esc_html__( 'Your rights.', 'contextchat' ) . '</strong> ' .
			/* translators: %s: contact email. */
			esc_html( sprintf( __( 'You may ask for information about this processing, a copy of your chat, correction, deletion, or for processing to be paused or limited, and you may object to decisions made only by automated means. The chat gives estimates only; our team confirms every price. Write to %s and quote the chat reference shown at the top of the chat (it starts with CC-). We answer within 3 × 24 hours after checking that the request is yours.', 'contextchat' ), $contact ) )
		);
		$html .= $p( '<strong>' . esc_html__( 'Security.', 'contextchat' ) . '</strong> ' . esc_html__( 'Chats are stored in our website database and only our administrators can read them. If chat data is ever exposed, we will tell you and the data protection authority in writing within 3 × 24 hours.', 'contextchat' ) );
		$html .= $p( esc_html__( '[Children: the chat is meant for adults. Decide with your legal review how you identify visitors under 18 and obtain a parent\'s or guardian\'s consent, as PP 33/2026 Article 38 requires.]', 'contextchat' ) );
		return $html;
	}
}
