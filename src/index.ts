import { formatNumber, isEmpty } from "./helpers";
import PricesWorker, { Options, PricesClass, Tickers, WorkerReady } from "./worker";
import { Pairs } from './paris';
import CustomCurrency from "./custom";

const CustomWorkers = new CustomCurrency();

interface Convert extends Pairs {
	/**
	 * Update options
	 */
	setOptions: (options?: Options)=> PricesClass,
	
	/**
	 * Price Tickers
	 */
	ticker: Tickers,

	/**
	 * Supported currencies list
	 */
	list: {
		crypto: string[],
		fiat: string[]
	},

	/**
	 * Metadata information about cryptocurrencies
	 */
	cryptoInfo:{	
		[crypto: string]:{
			id: number,
			symbol: string,
			title: string,
			logo: string,
			rank: number
		}
	}

	/**
	 * Quick check if cache has loaded.
	 */
	isReady: boolean,

	/**
	 * Get crypto prices last updated ms
	 */
	lastUpdated: number,
	
	/**
	 * Promise function that resolves when cache has loaded.
	 */
	ready: ()=> Promise<Convert>,

	/**
	 * Stop the worker. 
	 * 
	 * It's recommended to do this on Component unmounts (i.e if you are using React).
	 */
	stop: ()=> PricesClass,

	/**
	 * Re-start the worker when it has been stopped.
	 * 
	 * Returns a promise to wait for when it's ready.
	 * 
	 * ```javascript
	 * const is_ready = await convert.start();
	 * ```
	 */

	start: ()=> Promise<PricesClass>,


	/**
	 * Add a custom currency fetcher. Can be anything.
	 * 
	 * @example
	 * ```javascript
	 * convert.addCurrency('ANY','USD', async fetchPrice()=>{
	 * 		//...call your api here
	 * 		return price;
	 * }, 10000);
	 * ```
	 */
	addCurrency: typeof CustomWorkers.addCurrency,

	/**
	 * Remove custom currency fetcher.
	 */
	removeCurrency: (base: string, quote?: string)=>void

	/*
		[fromCurrency: string]: {
			[toCurrency: string]: (amount: number)=> number | false | null
		}
	*/
}

/**
 * This is the main object
 */
const ConvertObject = function(){
	
	const convert = {
		get isReady() {
			return PricesWorker.isReady;
		},
		get list(){
			return {
				'crypto': PricesWorker.list.crypto.concat(CustomWorkers.list),
				'fiat': PricesWorker.list.fiat
			}
		},
		get cryptoInfo(){
			return PricesWorker.cryptoInfo
		},
		get lastUpdated(){
			return PricesWorker.data.crypto.last_updated
		},
		get ticker(){
			return PricesWorker.data;
		}
	}

	//Get symbol price from tickers
	const getPrice = function(coin: string,	to='USD'){
	
		var customResult = CustomWorkers.ticker[coin+to] || (
			CustomWorkers.ticker[to + coin] ? 1/CustomWorkers.ticker[to + coin] : null
		);
	
		var result = PricesWorker.data.crypto.current[coin + to] || (
			PricesWorker.data.crypto.current[to + coin] ? 1/PricesWorker.data.crypto.current[to + coin] : null
		);
	
		return customResult || result;
	}
	
	//Conversion function
	const wrapper = function(coin: string, currency: string){
		var coin = coin;
		var toCurrency = currency;
		
		var doExchange = function(fromAmount: number){
			
			if(isEmpty(PricesWorker.data.crypto.current) || isEmpty(PricesWorker.data.fiat.current)){
				console.warn("[~] Prices are loading.\nYou should use `await convert.ready()` to make sure prices are loaded before calling convert.");
				return false;
			}

			if(!fromAmount){
				return false;
			}

			fromAmount = formatNumber(fromAmount);
			
			if(isNaN(fromAmount)){
				return false;
			}
			
			const fiatCurrencies = PricesWorker.data.fiat.current;
			const cryptoCurrenciesList = PricesWorker.list.crypto.concat(CustomWorkers.list);

			//Same
			if(toCurrency == coin){
				return fromAmount;
			}
		
			//Crypto to Crypto
			if(cryptoCurrenciesList.includes(coin) && cryptoCurrenciesList.includes(toCurrency)){
				let exchangePrice = getPrice(coin, toCurrency) ||
					wrapper("USD", toCurrency)(wrapper(coin, "USD")(1) as number);
				
				
				return formatNumber(exchangePrice * fromAmount, 8); 
			}
			
			//Fiat to Fiat
			if(fiatCurrencies[coin] && fiatCurrencies[toCurrency]){
				
				return formatNumber(
					((fromAmount / fiatCurrencies[coin]) * fiatCurrencies[toCurrency]),
					4
				);
			}
			
			
			//Crypto->Fiat || Crypto->BTC->Fiat
			var getCryptoPrice = function (coin: string) {
				var coinPrice = getPrice(coin) ||
					wrapper("BTC","USD")(getPrice(coin,"BTC") as number) || 
					wrapper("ETH","USD")(getPrice(coin,"ETH") as number);
				
				return coinPrice;
			}
			
			//Crypto to Fiat
			if(fiatCurrencies[toCurrency]){
				let usdPrice = getCryptoPrice(coin);
				let exchangePrice = (usdPrice / fiatCurrencies['USD']) * fiatCurrencies[toCurrency]; //Convert USD to chosen FIAT
				return formatNumber(exchangePrice * fromAmount, 8);
			}

			//Fiat to Crypto
			if(fiatCurrencies[coin]){
				let usdPrice = getCryptoPrice(toCurrency);
				let exchangePrice = (usdPrice / fiatCurrencies['USD']) * fiatCurrencies[coin]; //Convert USD to chosen FIAT
				return formatNumber(fromAmount / exchangePrice, 8);
			}

			return null;
		}
		return doExchange;
	}

	//Build pairs object & types
	const initialize = function () {
		let types = '';

		//Generate typescript interface
		types += `type amount = (amount: number | string) => number | false | null;`;
		types +='\nexport interface Pairs {';

		const all_currencies = PricesWorker.list.crypto.concat(PricesWorker.list.fiat, CustomWorkers.list);

		for(var i = 0; i < all_currencies.length; i++) {
			var coin = all_currencies[i];
			

			if(!coin || typeof coin !== "string"){
				continue;
			}

			if(!convert[coin]) {
				convert[coin] = {};
			}
			

			types += `\n\t'${coin.replace(/\'/g,"\\'")}': {`

			for(var a = 0; a < all_currencies.length; a++) {
				var currency = all_currencies[a];

				if(!currency || typeof currency !== "string"){
					continue;
				}

				convert[coin][currency] = wrapper(coin, currency);

				types += `\n\t\t'${currency.replace(/\'/g,"\\'")}': amount,`;
			}

			types += '\n},';
		}

		types +='\n}';

		//Create types file for Node.js. With Runtime types generation ^^
		if(typeof window === "undefined" && typeof module !== "undefined" && typeof process !== "undefined"){
			(async function(){
				try{
					// Here we save the types file. Using eval because static linting checks on frontend apps are annoying af.
					eval(`
						const fs = require('fs');
						const path = require('path');
						const isDist = path.basename(__dirname) == 'dist';
						const typesFile = path.join(__dirname, isDist ? 'paris.d.ts' : 'paris.ts');

						fs.writeFileSync(typesFile, types, 'utf-8');
					`);
				}
				catch(err){
					console.warn(err);
				}
			})();
		}
	};

	//These below here are just proxy methods to the worker object.

	convert['setOptions'] = function (options: Options) {

		let update = PricesWorker.setOptions(options);

		if((options.crypto_interval || options.fiat_interval) && (
			options.crypto_interval !== PricesWorker.options.crypto_interval ||
			options.fiat_interval !== PricesWorker.options.fiat_interval
		)){

			//Restart the worker in order to clear interval & update to new interval
			let restart = update.restart();
			convert['ready'] = async function () {
				await Promise.resolve(restart);
				await Promise.resolve(CustomWorkers.ready());
				return convert;
			};
			return restart;
		}

		return update;
	}

	convert['stop'] = function(){
		return PricesWorker.stop();
	}

	convert['start'] = function(){
		let restart = PricesWorker.restart();
		convert['ready'] = async function () {
			await Promise.resolve(restart);
			await Promise.resolve(CustomWorkers.ready());
			return convert;
		};
		return restart;
	}

	convert['ready'] = async function () {
		await Promise.resolve(WorkerReady);
		await Promise.resolve(CustomWorkers.ready());
		return convert;
	}

	convert['addCurrency'] = (base: string, ...rest: any)=>{

		if(convert.hasOwnProperty(base)){
			throw new Error("This property already exists.");
		}

		return Promise.resolve(
			CustomWorkers.addCurrency.apply(CustomWorkers, [base, ...rest])
		).then(()=>{
			if(PricesWorker.isReady){
				initialize();
			}
		});
	};

	convert['removeCurrency'] = (base: string, quote?: string)=>{

		if(CustomWorkers.list.includes(base)){
			delete convert[base];

			const all_currencies = PricesWorker.list.crypto.concat(PricesWorker.list.fiat, CustomWorkers.list);

			for(const currency of all_currencies){
				if(convert[currency]?.[base]){
					delete convert[currency]?.[base];
				}
			}
		}

		return CustomWorkers.removeCurrency(base, quote);
	}

	//Wait for updated lists before initializing 
	Promise.resolve(WorkerReady).then(()=>(
		initialize()
	));

	return convert;
}();

/**
 * Convert crypto to fiat and vice-versa.
 * 
 * ```javascript
 * convert.BTC.USD(1);
 * convert.USD.BTC(1);
 * convert.BTC.ETH(1);
 * convert.ETH.JPY(1);
 * convert.USD.EUR(1);
 * ```
 * 
 * To check supported currencies:
 * ```javascript
 * let supportedCurrencies = convert.list;
 * ```
 * 
 * To change options:
 * 
 * ```javascript
 * convert.setOptions({
 *		crypto_interval: 5000, //Crypto prices update interval, default every 5 seconds
 *		fiat_interval: (60 * 1e3 * 60), //Fiat prices update interval, default every 1 hour
 *		binance: true, //Use binance rates
 *		bitfinex: true, //Use bitfinex rates
 *		coinbase: true, //Use coinbase rates
 *		onUpdate: (tickers, isFiat)=> any //Callback to run on prices update	
 * });
 * ```
 */
const convert = ConvertObject as unknown as Convert;

//@ts-ignore
convert.default = convert;
if(typeof module !== "undefined" && module.exports){
	module.exports = convert;
}

export default convert;