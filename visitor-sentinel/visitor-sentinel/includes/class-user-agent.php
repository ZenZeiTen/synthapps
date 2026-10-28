<?php
/**
 * Lightweight user agent parsing and bot detection.
 *
 * This class has no WordPress dependencies so it can be unit tested on its own.
 *
 * @package VisitorSentinel
 */

namespace VisitorSentinel;

defined( 'ABSPATH' ) || exit;

/**
 * Reads browser, operating system, device type and automation markers from a user agent.
 */
final class User_Agent {

	/**
	 * Search engine and ad platform crawlers. They are flagged as bots but never auto-blocked,
	 * because blocking them would hurt search ranking or ad approval.
	 */
	const GOOD_BOTS = '/googlebot|adsbot-google|mediapartners-google|google-inspectiontool|googleother|storebot-google|bingbot|adidxbot|bingpreview|applebot|duckduckbot|yandex(?:bot|images|mobilebot)|baiduspider|slurp|facebookexternalhit|facebookcatalog|meta-externalagent|linkedinbot|twitterbot|pinterestbot/i';

	/**
	 * Automation, crawler and HTTP library markers.
	 */
	const BOTS = '/bot\b|bot\/|crawl|spider|slurp|scrap|curl\/|wget|python|httpclient|http-client|http_request|go-http-client|java\/|okhttp|axios|node-fetch|undici|libwww|lwp::|perl\/|ruby|php\/|guzzle|headless|phantomjs|selenium|puppeteer|playwright|webdriver|lighthouse|pagespeed|pingdom|uptime|statuscake|monitor|preview|validator|archiver|ahrefs|semrush|mj12|dotbot|petalbot|bytespider|gptbot|ccbot|claudebot|perplexity|amazonbot|dataforseo|seznam|feedfetcher|nutch|zgrab|masscan|nmap|nikto|sqlmap/i';

	/**
	 * Headless browser builds that still claim to be a normal browser.
	 */
	const HEADLESS = '/headlesschrome|phantomjs|slimerjs|htmlunit|puppeteer|playwright|selenium/i';

	/**
	 * Parse a user agent.
	 *
	 * @param string $ua User agent.
	 * @return array Keys: browser, os, device, is_bot, good_bot, headless.
	 */
	public static function parse( $ua ) {
		$ua = (string) $ua;

		// Cubot is a phone brand, not a crawler.
		$probe    = preg_replace( '/cubot/i', 'cu-phone', $ua );
		$good_bot = (bool) preg_match( self::GOOD_BOTS, $ua );
		$headless = (bool) preg_match( self::HEADLESS, $ua );
		$is_bot   = '' === trim( $ua ) || $good_bot || $headless || (bool) preg_match( self::BOTS, $probe );

		return array(
			'browser'  => self::browser( $ua ),
			'os'       => self::os( $ua ),
			'device'   => $is_bot ? 'bot' : self::device( $ua ),
			'is_bot'   => $is_bot,
			'good_bot' => $good_bot,
			'headless' => $headless,
		);
	}

	/**
	 * Browser family.
	 *
	 * @param string $ua User agent.
	 * @return string
	 */
	private static function browser( $ua ) {
		$map = array(
			'/Edg(?:e|A|iOS)?\//'     => 'Edge',
			'/OPR\/|Opera/'           => 'Opera',
			'/SamsungBrowser/'        => 'Samsung Internet',
			'/YaBrowser/'             => 'Yandex',
			'/UCBrowser/'             => 'UC Browser',
			'/Vivaldi/'               => 'Vivaldi',
			'/Firefox\/|FxiOS/'       => 'Firefox',
			'/Chrome\/|CriOS|Chromium/' => 'Chrome',
			'/Version\/[\d.]+.*Safari/' => 'Safari',
			'/MSIE |Trident\//'       => 'Internet Explorer',
		);
		foreach ( $map as $pattern => $name ) {
			if ( preg_match( $pattern, $ua ) ) {
				return $name;
			}
		}
		return 'Other';
	}

	/**
	 * Operating system family.
	 *
	 * @param string $ua User agent.
	 * @return string
	 */
	private static function os( $ua ) {
		$map = array(
			'/Windows Phone/'          => 'Windows Phone',
			'/Windows NT|Win64|Win32/' => 'Windows',
			'/iPhone|iPad|iPod/'       => 'iOS',
			'/Android/'                => 'Android',
			'/CrOS/'                   => 'ChromeOS',
			'/Mac OS X|Macintosh/'     => 'macOS',
			'/Linux|X11/'              => 'Linux',
		);
		foreach ( $map as $pattern => $name ) {
			if ( preg_match( $pattern, $ua ) ) {
				return $name;
			}
		}
		return 'Other';
	}

	/**
	 * Device class.
	 *
	 * @param string $ua User agent.
	 * @return string
	 */
	private static function device( $ua ) {
		if ( preg_match( '/iPad|Tablet|PlayBook|Silk|Kindle/i', $ua ) || ( preg_match( '/Android/i', $ua ) && ! preg_match( '/Mobile/i', $ua ) ) ) {
			return 'tablet';
		}
		if ( preg_match( '/Mobi|iPhone|iPod|Android|Windows Phone|BlackBerry|Opera Mini/i', $ua ) ) {
			return 'mobile';
		}
		return 'desktop';
	}
}
