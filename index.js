(function(global){

	function forOf(iterable, fn, bind){
		var method, iterator, next, result;

		method = iterable[Symbol.iterator];

		if( typeof method !== 'function' ){
			throw new TypeError(iterable + 'is not iterable');
		}

		if( typeof fn != 'function' ){
			throw new TypeError('second argument must be a function');
		}

		iterator = method.call(iterable);
		next = iterator.next();
		while( next.done === false ){
			try{
				fn.call(bind, next.value);
			}
			catch(e){
				if( typeof iterator['return'] === 'function' ){
					iterator['return']();
				}
				throw e;
			}
			next = iterator.next();
		}
	}

	function callThenable(thenable, resolve, reject){
		var then;

		try{
			then = thenable.then;
			then.call(thenable, resolve, reject);
		}
		catch(e){
			reject(e);
		}
	}

	function isThenable(object){
		return Object(object) == object ? typeof object.then === 'function' : false;
	}

	var Promise = {
		executor: function(resolve, reject){},
		state: 'pending',
		value: null,
		pendingList: null,
		onResolve: null,
		onReject: null,

		constructor: function(executor){
			if( arguments.length === 0 ){
				throw new Error('missing executor function');
			}
			if( typeof executor != 'function' ){
				throw new TypeError('function expected as executor');
			}

			this.state = 'pending';
			this.resolver = this.resolve.bind(this);
			this.rejecter = this.reject.bind(this);

			if( executor != this.executor ){
				try{
					executor(this.resolver, this.rejecter);
				}
				catch(e){
					this.reject(e);
				}
			}
		},

		toString: function(){
			return '[object Promise]';
		},

		createPending: function(onResolve, onReject){
			var promise = new this.constructor(this.executor);
			promise.onResolve = onResolve;
			promise.onReject = onReject;
			return promise;
		},

		adoptState: function(promise){
			var isResolved, fn, value, ret, error;

			value = promise.value;
			isResolved = promise.state === 'fulfilled';
			fn = isResolved ? this.onResolve : this.onReject;

			if( fn != null ){
				try{
					ret = fn(value);
				}
				catch(e){
					error = e;
				}

				if( error ){
					isResolved = false;
					value = error;
				}
				else{
					isResolved = true;
					value = ret;
				}
			}

			if( isResolved ){
				this.resolve(value);
			}
			else{
				this.reject(value);
			}
		},

		addPending: function(promise){
			this.pendingList = this.pendingList || [];
			this.pendingList.push(promise);
		},

		startPending: function(pending){
			pending.adoptState(this);
		},

		// called when the promise is settled
		clean: function(){
			if( this.pendingList ){
				this.pendingList.forEach(this.startPending, this);
				this.pendingList = null;
			}
		},

		onFulFilled: function(value){
			this.clean();
		},

		onRejected: function(value){
			this.clean();

			// then() never called
			if( !this.handled ){
				this.unhandled = global.setImmediate(function(){
					this.unhandled = null;
					if( !this.handled ){ // then() still never called
						var mess;

						if( typeof window != 'undefined' ){
							if( !window.onrejectionhandled ){
								mess = value instanceof Error ? value.stack : value;
								console.log('possibly unhandled rejection "' + value + '" for promise', this);
							}
							else{
								window.onrejectionhandled(value, this);
							}
						}
						else if( typeof process != 'undefined' ){
							if( process.listeners('unhandledRejection').length === 0 ){
								mess = value instanceof Error ? value.stack : value;
								console.log('possibly unhandled rejection "' + mess + '" for promise', this);
							}
							process.emit('unhandledRejection', value, this);
						}
					}
				}.bind(this));
			}
		},

		resolvedValueResolver: function(value){
			if( isThenable(value) ){
				if( value === this ){
					this.reject(new TypeError('A promise cannot be resolved with itself'));
				}
				else{
					callThenable(value, this.resolver, this.rejecter);
				}
			}
			else{
				this.state = 'fulfilled';
				this.resolving = false;
				this.value = value;
				this.onFulFilled(value);
			}
		},

		resolve: function(value){
			if( this.state === 'pending' ){
				if( !this.resolving ){
					this.resolving = true;
					this.resolver = this.resolvedValueResolver.bind(this);
					this.resolver(value);
				}
			}
		},

		reject: function(value){
			if( this.state === 'pending' ){
				this.state = 'rejected';
				this.value = value;
				this.onRejected(value);
			}
		},

		then: function(onResolve, onReject){
			if( onResolve && typeof onResolve != 'function' ){
				throw new TypeError('onResolve must be a function ' + onResolve + ' given');
			}
			if( onReject && typeof onReject != 'function' ){
				throw new TypeError('onReject must be a function ' + onReject + ' given');
			}

			var pending = this.createPending(onResolve, onReject);

			this.handled = true;

			if( this.state === 'pending' ){
				this.addPending(pending);
			}
			else{
				global.setImmediate(function(){
					this.startPending(pending);
				}.bind(this));

				if( this.unhandled ){
					global.clearImmediate(this.unhandled);
					this.unhandled = null;
				}
			}

			return pending;
		},

		catch: function(onreject){
			return this.then(null, onreject);
		}
	};

	Promise.constructor.prototype = Promise;
	Promise = Promise.constructor;

	// que fait-on lorsque value est thenable?
	Promise.resolve = function(value){
		if( value instanceof Promise ) return value;

		return new this(function resolveExecutor(resolve){
			resolve(value);
		});
	};

	Promise.reject = function(value){
		return new this(function rejectExecutor(resolve, reject){
			reject(value);
		});
	};

	Promise.all = function(iterable){
		return new this(function allExecutor(resolve, reject){
			function res(value, index){
				if( isThenable(value) ){
					callThenable(value, function(value){ res(value, index); }, reject);
				}
				else{
					values[index] = value;
					length--;
					if( length === 0 ) resolve(values);
				}
			}

			var index = 0, length = 0, values = [];

			forOf(iterable, function(value){
				length++;
				res(value, index);
				index++;
			});

			if( length === 0 ) resolve(values);
		});
	};

	Promise.race = function(iterable){
		return new this(function(resolve, reject){
			forOf(iterable, function(thenable){
				thenable.then(resolve, reject);
			});
		});
	};

	Promise.polyfill = true;

	var hasUnhandledRejectionHook = false;
	if( global.Promise ){
		if( global.Promise.polyfill ) hasUnhandledRejectionHook = true;
		// node has no unhandled rejection hook
	}

	// force Promise polyfill when the global.Promise has no unhandled rejection hook
	if( !hasUnhandledRejectionHook || !global.Promise ){
		global.Promise = Promise;
	}

})(typeof window != 'undefined' ? window : global);