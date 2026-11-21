/**
 * ContextChat price engine, browser copy (design plan section 7).
 *
 * The server's result (includes/si/class-price-engine.php) is the one that counts; this copy
 * exists so the quote card can be checked against the same rules, and both run the vectors in
 * tests/fixtures/prices.json. It takes an explicit legalisation route only: choosing a route
 * from a country happens on the server.
 */
( function ( root, factory ) {
	const api = factory();
	if ( typeof module === 'object' && module.exports ) {
		module.exports = api;
	} else {
		root.ContextChatPrice = api;
	}
}( typeof self !== 'undefined' ? self : this, function () {
	'use strict';

	const LANGS = [ 'id', 'en', 'zh', 'ja', 'ko', 'de', 'fr', 'es', 'it', 'nl', 'ar', 'ru', 'pt' ];
	const SPEEDS = [ 'standard', 'next_day', 'same_day' ];
	const LEGAL = [ 'none', 'apostille', 'ministry_embassy' ];
	const MAX_COUNT = 10000;

	function count( value ) {
		let n;
		if ( typeof value === 'number' && Number.isInteger( value ) ) {
			n = value;
		} else if ( typeof value === 'string' && /^\s*\d+\s*$/.test( value ) ) {
			n = parseInt( value, 10 );
		} else {
			return 0;
		}
		return n >= 1 && n <= MAX_COUNT ? n : 0;
	}

	// Integer division rounded half up, for non-negative whole numbers below 2^52.
	function roundDiv( num, den ) {
		return Math.floor( ( 2 * num + den ) / ( 2 * den ) );
	}

	function quote( table, input ) {
		const errors = [];
		const pkg = input.package;
		if ( pkg !== 'regular' && pkg !== 'sworn' ) {
			errors.push( 'package' );
		}
		const source = String( input.source_lang || '' ).trim().toLowerCase();
		const target = String( input.target_lang || '' ).trim().toLowerCase();
		if ( ! LANGS.includes( source ) ) {
			errors.push( 'source_lang' );
		}
		if ( ! LANGS.includes( target ) || target === source ) {
			errors.push( 'target_lang' );
		}
		const pages = count( input.pages );
		const documents = count( input.documents );
		if ( pages < Math.max( 1, table.min_pages || 1 ) ) {
			errors.push( 'pages' );
		}
		if ( documents < 1 ) {
			errors.push( 'documents' );
		}
		const speed = input.speed || 'standard';
		if ( ! SPEEDS.includes( speed ) ) {
			errors.push( 'speed' );
		}
		const legalisation = input.legalisation || 'none';
		if ( ! LEGAL.includes( legalisation ) ) {
			errors.push( 'legalisation' );
		}
		const legalDocs = input.legal_documents === undefined ? documents : count( input.legal_documents );
		if ( legalDocs < 1 && legalisation !== 'none' ) {
			errors.push( 'legal_documents' );
		}
		if ( errors.length ) {
			return { status: 'invalid', errors };
		}

		const pair = ( table.rates || {} )[ source + '-' + target ];
		const rate = pair ? pair[ pkg ] : null;
		if ( ! rate ) {
			return { status: 'unavailable', reason: pair ? 'package_not_offered' : 'pair_not_offered' };
		}

		const translation = rate * pages;
		const express = ( table.express_percent || {} )[ speed ] || ( speed === 'standard' ? 100 : 0 );
		let discountPercent = 0;
		for ( const tier of table.volume_discounts || [] ) {
			if ( documents >= tier.min_documents && tier.percent > discountPercent ) {
				discountPercent = tier.percent;
			}
		}
		const translationNet = roundDiv( translation * express * ( 100 - discountPercent ), 10000 );
		const withExpress = roundDiv( translation * express, 100 );

		const fees = table.legalisation || {};
		let legalTotal = 0;
		if ( legalisation === 'apostille' ) {
			legalTotal = fees.apostille * legalDocs;
		} else if ( legalisation === 'ministry_embassy' ) {
			legalTotal = ( fees.ministry + fees.embassy ) * legalDocs;
		}

		const total = translationNet + legalTotal;
		const rule = table.deposit || { min_total: 1000000, percent: 50 };
		const deposit = total >= rule.min_total ? roundDiv( total * rule.percent, 100 ) : 0;
		const team = [];
		if ( speed !== 'standard' ) {
			team.push( 'express' );
		}
		if ( input.matter === 'corporate' && documents > 40 ) {
			team.push( 'corporate_volume' );
		}

		return {
			status: team.length ? 'needs_team' : 'ok',
			team_reasons: team,
			express_surcharge: withExpress - translation,
			discount_percent: discountPercent,
			discount: withExpress - translationNet,
			translation_total: translationNet,
			legalisation_total: legalTotal,
			total,
			deposit,
		};
	}

	// "Rp 1.775.000", the way the site writes amounts.
	function rupiah( amount ) {
		return 'Rp ' + String( amount ).replace( /\B(?=(\d{3})+(?!\d))/g, '.' );
	}

	return { quote, rupiah };
} ) );
