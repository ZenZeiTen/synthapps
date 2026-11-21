<?php
/**
 * Handoff to a person (design plan sections 6.4 and 6.5): the summary the visitor sends, the
 * WhatsApp and email links, and which agent receives it.
 *
 * Pure PHP apart from the link builder it is given. The visitor sees and can edit the summary,
 * then sends it themselves; nothing is sent on their behalf.
 *
 * @package ContextChat
 */

defined( 'ABSPATH' ) || exit;

/**
 * Handoff summaries and links.
 */
class ContextChat_Handoff {

	/** WhatsApp text limit, a conservative length for wa.me links. */
	const MAX_WHATSAPP = 1000;

	/** Why a chat was handed over, in both languages. */
	const REASONS = array(
		'visitor_asked' => array( 'minta dihubungkan dengan tim', 'asked for the team' ),
		'hesitation'    => array( 'minta penyesuaian harga', 'asked about the price' ),
		'complex'       => array( 'kebutuhan khusus', 'special request' ),
		'unavailable'   => array( 'layanan belum tersedia di daftar harga', 'service not in the price list' ),
		'unanswered'    => array( 'pertanyaan belum terjawab', 'question not answered' ),
		'interpreting'  => array( 'permintaan interpretasi', 'interpreting request' ),
		'documents'     => array( 'ingin mengirim dokumen', 'wants to send documents' ),
		'idle'          => array( 'lanjut setelah estimasi', 'continuing after the estimate' ),
		'limit'         => array( 'percakapan panjang', 'long conversation' ),
		'busy'          => array( 'sistem sedang sibuk', 'system busy' ),
		'blocked'       => array( 'demi keamanan data', 'for data security' ),
		'other'         => array( 'lainnya', 'other' ),
	);

	/**
	 * The summary text (WhatsApp version), at most MAX_WHATSAPP characters, trimmed starting
	 * with the lowest-priority lines.
	 *
	 * @param array  $state   service, intake, quote (latest result), reason, reference, page.
	 * @param string $lang    'id' or 'en'.
	 * @param string $site    Business name.
	 * @param bool   $email   Email version (other greeting).
	 * @return string
	 */
	public static function summary( array $state, $lang, $site, $email = false ) {
		$en      = 'en' === $lang;
		$i       = isset( $state['intake'] ) && is_array( $state['intake'] ) ? $state['intake'] : array();
		$service = isset( $state['service'] ) ? (string) $state['service'] : '';
		$quote   = isset( $state['quote'] ) && is_array( $state['quote'] ) ? $state['quote'] : array();
		$names   = ContextChat_Price_Engine::LANG_NAMES[ $en ? 'en' : 'id' ];
		$lines   = array(); // priority => line; lower numbers are kept longest.

		$greeting = $email
			? ( $en ? "Hello {$site} team," : "Halo tim {$site}," )
			: ( $en ? "Hello {$site}, I'm continuing from the website chat." : "Halo {$site}, saya lanjut dari chat website." );
		$ref      = ! empty( $quote['reference'] ) ? $quote['reference'] : ( isset( $state['reference'] ) ? $state['reference'] : '' );

		$lines[0][] = $greeting;
		if ( '' !== $ref ) {
			$lines[0][] = 'Ref: ' . $ref;
		}
		if ( 'interpreting' === $service ) {
			$type       = isset( $i['type'] ) ? self::scalar( $i['type'] ) : '';
			$lines[1][] = ( $en ? 'Service: Interpreting' : 'Layanan: Interpretasi' ) . ( '' !== $type ? ' (' . $type . ')' : '' );
			if ( isset( $i['language_pair'] ) ) {
				$lines[1][] = ( $en ? 'Languages: ' : 'Bahasa: ' ) . self::scalar( $i['language_pair'] );
			}
			$when = trim( implode( ' ', array_filter( array( isset( $i['date'] ) ? self::scalar( $i['date'] ) : '', isset( $i['start_time'] ) ? self::scalar( $i['start_time'] ) : '' ) ) ) );
			if ( isset( $i['duration'] ) ) {
				$when .= ( '' !== $when ? ', ' : '' ) . self::scalar( $i['duration'] ) . ( $en ? ' hours' : ' jam' );
			}
			if ( '' !== $when ) {
				$lines[1][] = ( $en ? 'When: ' : 'Waktu: ' ) . $when;
			}
			if ( isset( $i['venue'] ) ) {
				$lines[1][] = ( $en ? 'Venue: ' : 'Tempat: ' ) . self::scalar( $i['venue'] );
			}
			if ( isset( $i['preference'] ) ) {
				$lines[3][] = ( $en ? 'Preference: ' : 'Preferensi: ' ) . self::scalar( $i['preference'] );
			}
		} else {
			$sworn = isset( $quote['package'] ) ? 'sworn' === $quote['package'] : ( isset( $i['sworn'] ) ? self::truthy( $i['sworn'] ) : null );
			if ( null !== $sworn || 'translation' === $service ) {
				$label      = null === $sworn ? ( $en ? 'Translation' : 'Terjemahan' ) : ( $sworn ? ( $en ? 'Sworn translation' : 'Terjemahan tersumpah' ) : ( $en ? 'Regular translation' : 'Terjemahan reguler' ) );
				$lines[1][] = ( $en ? 'Service: ' : 'Layanan: ' ) . $label;
			}
			$docs   = isset( $i['document_types'] ) ? self::scalar( $i['document_types'] ) : '';
			$counts = array();
			$nd     = ! empty( $quote['documents'] ) ? (int) $quote['documents'] : ( isset( $i['documents_count'] ) ? (int) $i['documents_count'] : 0 );
			$np     = ! empty( $quote['pages'] ) ? (int) $quote['pages'] : ( isset( $i['pages_count'] ) ? (int) $i['pages_count'] : 0 );
			if ( $nd ) {
				$counts[] = $nd . ( $en ? ( 1 === $nd ? ' document' : ' documents' ) : ' dokumen' );
			}
			if ( $np ) {
				$counts[] = $np . ( $en ? ( 1 === $np ? ' page' : ' pages' ) : ' halaman' );
			}
			if ( '' !== $docs || $counts ) {
				$lines[1][] = ( $en ? 'Documents: ' : 'Dokumen: ' ) . trim( $docs . ( $counts ? ' (' . implode( ', ', $counts ) . ')' : '' ) );
			}
			$src = ! empty( $quote['source_lang'] ) ? $quote['source_lang'] : ( isset( $i['source_lang'] ) ? self::scalar( $i['source_lang'] ) : '' );
			$tgt = ! empty( $quote['target_lang'] ) ? $quote['target_lang'] : ( isset( $i['target_lang'] ) ? self::scalar( $i['target_lang'] ) : '' );
			if ( '' !== $src && '' !== $tgt ) {
				$lines[1][] = ( $en ? 'Languages: ' : 'Bahasa: ' ) . ( isset( $names[ $src ] ) ? $names[ $src ] : $src ) . ' → ' . ( isset( $names[ $tgt ] ) ? $names[ $tgt ] : $tgt );
			}
			$route = ! empty( $quote['legalisation'] ) ? $quote['legalisation'] : ( isset( $i['legalisation'] ) ? self::scalar( $i['legalisation'] ) : '' );
			$route_names = array(
				'none'             => $en ? 'None' : 'Tidak perlu',
				'apostille'        => 'Apostille',
				'ministry_embassy' => $en ? 'Kemenkum/Kemenlu and embassy' : 'Kemenkum/Kemenlu dan kedutaan',
			);
			if ( isset( $route_names[ $route ] ) ) {
				$lines[2][] = ( $en ? 'Legalisation: ' : 'Legalisasi: ' ) . $route_names[ $route ];
			}
			if ( ! empty( $quote['total'] ) ) {
				$est = ( $en ? 'Estimate: ' : 'Estimasi: ' ) . ContextChat_Prompt::rp( $quote['total'] );
				if ( ! empty( $quote['deposit'] ) ) {
					$est .= ' (DP 50%: ' . ContextChat_Prompt::rp( $quote['deposit'] ) . ')';
				}
				$lines[1][] = $est;
			}
			if ( isset( $i['speed'] ) && in_array( $i['speed'], array( 'next_day', 'same_day' ), true ) ) {
				$lines[2][] = ( $en ? 'Speed: ' : 'Kecepatan: ' ) . ( 'next_day' === $i['speed'] ? ( $en ? 'next day' : 'besok jadi' ) : ( $en ? 'same day' : 'hari ini jadi' ) );
			}
			if ( isset( $i['deadline'] ) ) {
				$lines[2][] = ( $en ? 'Deadline: ' : 'Tenggat: ' ) . self::scalar( $i['deadline'] );
			}
		}

		$purpose = array();
		if ( isset( $i['matter'] ) ) {
			$purpose[] = 'corporate' === $i['matter'] ? ( $en ? 'Company' : 'Perusahaan' ) : ( $en ? 'Personal' : 'Pribadi' );
		}
		foreach ( array( 'purpose', 'destination' ) as $key ) {
			if ( isset( $i[ $key ] ) && '' !== self::scalar( $i[ $key ] ) ) {
				$purpose[] = self::scalar( $i[ $key ] );
			}
		}
		if ( $purpose ) {
			$lines[3][] = ( $en ? 'Purpose: ' : 'Keperluan: ' ) . implode( ' · ', $purpose );
		}
		if ( isset( $i['payment_account'] ) ) {
			$lines[4][] = ( $en ? 'Payment: ' : 'Pembayaran: ' ) . ( 'corporate' === $i['payment_account'] ? ( $en ? 'company account' : 'Rekening perusahaan' ) : ( $en ? 'personal account' : 'Rekening pribadi' ) );
		}
		$missing = self::missing( $service, $i, $en );
		if ( $missing ) {
			$lines[5][] = ( $en ? 'Not given yet: ' : 'Belum diisi: ' ) . implode( ', ', $missing );
		}
		$reason = isset( $state['reason'] ) ? (string) $state['reason'] : '';
		if ( isset( self::REASONS[ $reason ] ) ) {
			$lines[6][] = ( $en ? 'Reason: ' : 'Alasan diteruskan: ' ) . self::REASONS[ $reason ][ $en ? 1 : 0 ];
		}
		if ( ! empty( $state['page'] ) ) {
			$lines[7][] = ( $en ? 'Page: ' : 'Halaman: ' ) . preg_replace( '~^https?://(www\.)?~i', '', (string) $state['page'] );
		}

		// Drop the lowest-priority groups until the text fits.
		ksort( $lines );
		$text = self::join( $lines );
		while ( mb_strlen( $text, 'UTF-8' ) > self::MAX_WHATSAPP && count( $lines ) > 1 ) {
			array_pop( $lines );
			$text = self::join( $lines );
		}
		if ( mb_strlen( $text, 'UTF-8' ) > self::MAX_WHATSAPP ) {
			$text = mb_substr( $text, 0, self::MAX_WHATSAPP - 1, 'UTF-8' ) . '…';
		}
		return $text;
	}

	/**
	 * Email subject in the house format: [Site] Service - Ref - Permintaan Penawaran.
	 *
	 * @param array  $state State.
	 * @param string $lang  Language.
	 * @param string $site  Business name.
	 * @return string
	 */
	public static function subject( array $state, $lang, $site ) {
		$en      = 'en' === $lang;
		$quote   = isset( $state['quote'] ) && is_array( $state['quote'] ) ? $state['quote'] : array();
		$service = isset( $state['service'] ) ? (string) $state['service'] : '';
		if ( 'interpreting' === $service ) {
			$label = $en ? 'Interpreting' : 'Interpretasi';
		} elseif ( isset( $quote['package'] ) ) {
			$label = 'sworn' === $quote['package'] ? ( $en ? 'Sworn Translation' : 'Terjemahan Tersumpah' ) : ( $en ? 'Regular Translation' : 'Terjemahan Reguler' );
		} else {
			$label = $en ? 'Translation' : 'Terjemahan';
		}
		$ref = ! empty( $quote['reference'] ) ? $quote['reference'] : ( isset( $state['reference'] ) ? $state['reference'] : '' );
		return '[' . $site . '] ' . $label . ( '' !== $ref ? ' - ' . $ref : '' ) . ' - ' . ( $en ? 'Quotation Request' : 'Permintaan Penawaran' );
	}

	/**
	 * mailto: link with subject and body.
	 *
	 * @param string $address Email address.
	 * @param string $subject Subject.
	 * @param string $body    Body.
	 * @return string
	 */
	public static function mailto( $address, $subject, $body ) {
		return 'mailto:' . $address . '?subject=' . rawurlencode( $subject ) . '&body=' . rawurlencode( str_replace( "\n", "\r\n", $body ) );
	}

	/**
	 * The agent that receives a handoff: the one set for the service, else the first available
	 * agent. Returns null when there is none (the main number or email is used instead).
	 *
	 * @param array  $agents   Agents from the settings.
	 * @param string $agent_id Agent set for this service, or ''.
	 * @return array|null
	 */
	public static function agent( array $agents, $agent_id ) {
		$usable = array_values(
			array_filter(
				$agents,
				function ( $a ) {
					return empty( $a['disabled'] ) && ! empty( $a['phone'] );
				}
			)
		);
		foreach ( $usable as $agent ) {
			if ( '' !== $agent_id && $agent['id'] === $agent_id ) {
				return $agent;
			}
		}
		return $usable ? $usable[0] : null;
	}

	/**
	 * Required fields not given yet, in the visitor's language.
	 *
	 * @param string $service Service.
	 * @param array  $intake  Intake.
	 * @param bool   $en      English.
	 * @return string[]
	 */
	private static function missing( $service, array $intake, $en ) {
		$labels = array(
			'document_types'  => array( 'jenis dokumen', 'document type' ),
			'source_lang'     => array( 'bahasa asal', 'source language' ),
			'target_lang'     => array( 'bahasa tujuan', 'target language' ),
			'documents_count' => array( 'jumlah dokumen', 'number of documents' ),
			'pages_count'     => array( 'jumlah halaman', 'number of pages' ),
			'sworn'           => array( 'tersumpah atau reguler', 'sworn or regular' ),
			'destination'     => array( 'negara tujuan', 'destination' ),
			'deadline'        => array( 'tenggat', 'deadline' ),
			'venue'           => array( 'tempat', 'venue' ),
			'date'            => array( 'tanggal', 'date' ),
			'start_time'      => array( 'jam mulai', 'start time' ),
			'duration'        => array( 'durasi', 'duration' ),
			'type'            => array( 'jenis interpretasi', 'type of interpreting' ),
			'language_pair'   => array( 'pasangan bahasa', 'language pair' ),
		);
		if ( 'interpreting' === $service ) {
			$want = ContextChat_Prompt::INTERPRETING_REQUIRED;
		} elseif ( 'translation' === $service ) {
			$want = array_merge( ContextChat_Prompt::TRANSLATION_REQUIRED, array( 'destination', 'deadline' ) );
		} else {
			return array();
		}
		$out = array();
		foreach ( $want as $key ) {
			if ( ! isset( $intake[ $key ] ) || '' === self::scalar( $intake[ $key ] ) ) {
				$out[] = $labels[ $key ][ $en ? 1 : 0 ];
			}
		}
		return $out;
	}

	/**
	 * A field value as text.
	 *
	 * @param mixed $value Value.
	 * @return string
	 */
	private static function scalar( $value ) {
		if ( is_array( $value ) ) {
			$value = implode( ', ', array_map( 'strval', array_filter( $value, 'is_scalar' ) ) );
		} elseif ( is_bool( $value ) ) {
			return $value ? 'true' : 'false';
		}
		$value = trim( (string) $value );
		// One long field must not push the rest of the summary out.
		return mb_strlen( $value, 'UTF-8' ) > 160 ? rtrim( mb_substr( $value, 0, 159, 'UTF-8' ) ) . '…' : $value;
	}

	/**
	 * True for true, "true", "yes", "ya", 1.
	 *
	 * @param mixed $value Value.
	 * @return bool
	 */
	private static function truthy( $value ) {
		return true === $value || 1 === $value || in_array( strtolower( (string) $value ), array( 'true', 'yes', 'ya', '1' ), true );
	}

	/**
	 * Join the line groups in the order of the house summary (design plan section 6.5).
	 *
	 * @param array $lines Priority => lines.
	 * @return string
	 */
	private static function join( array $lines ) {
		$order = array( 'Ref:', 'Layanan:|Service:', 'Dokumen:|Documents:', 'Bahasa:|Languages:', 'Waktu:|When:', 'Tempat:|Venue:', 'Preferensi:|Preference:', 'Keperluan:|Purpose:', 'Legalisasi:|Legalisation:', 'Kecepatan:|Speed:', 'Tenggat:|Deadline:', 'Pembayaran:|Payment:', 'Estimasi:|Estimate:', 'Belum diisi:|Not given yet:', 'Alasan diteruskan:|Reason:', 'Halaman:|Page:' );
		$out   = array();
		foreach ( $lines as $group ) {
			foreach ( $group as $line ) {
				$rank = -1; // The greeting has no label and comes first.
				foreach ( $order as $i => $labels ) {
					foreach ( explode( '|', $labels ) as $label ) {
						if ( 0 === strpos( $line, $label ) ) {
							$rank = $i;
							break 2;
						}
					}
				}
				$out[] = array( $rank, count( $out ), $line );
			}
		}
		usort(
			$out,
			function ( $a, $b ) {
				return $a[0] - $b[0] ?: $a[1] - $b[1];
			}
		);
		return implode( "\n", array_column( $out, 2 ) );
	}
}
