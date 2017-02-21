/* eslint-env browser, node */

(function(global) {
    var forOf = (function() {
        if (typeof Symbol === 'function' && 'iterator' in Symbol) {
            return function forOf(iterable, fn, bind) {
                var method;
                var iterator;
                var next;

                method = iterable[Symbol.iterator];

                if (typeof method !== 'function') {
                    throw new TypeError(iterable + 'is not iterable');
                }

                if (typeof fn !== 'function') {
                    throw new TypeError('second argument must be a function');
                }

                iterator = method.call(iterable);
                next = iterator.next();
                while (next.done === false) {
                    try {
                        fn.call(bind, next.value);
                    } catch (e) {
                        if (typeof iterator['return'] === 'function') { // eslint-disable-line dot-notation
                            iterator['return'](); // eslint-disable-line dot-notation
                        }
                        throw e;
                    }
                    next = iterator.next();
                }
            };
        }
        return function forOf(iterable, fn, bind) {
            for (var key in iterable) {
                if (iterable.hasOwnProperty(key)) {
                    fn.call(bind, iterable[key]);
                }
            }
        };
    })();
    var triggerUnhandled = (function() {
        if (typeof window === 'object') {
            return function tiggerUnhandled(value, promise) {
                if (window.onunhandledrejection) {
                    window.onunhandledrejection(value, promise);
                } else {
                    // var mess = value instanceof Error ? value.stack : value;
                    console.log('possibly unhandled rejection "' + value + '" for promise', promise);
                }
            };
        }
        return function tiggerUnhandled(value, promise) {
            if (process.listeners('unhandledRejection').length === 0) {
                var mess = value instanceof Error ? value.stack : value;
                console.log('possibly unhandled rejection "' + mess + '" for promise', promise);
            }
            process.emit('unhandledRejection', value, promise);
        };
    })();
    var triggerHandled = (function() {
        if (typeof window === 'object') {
            return function triggerHandled(promise) {
                if (window.onrejectionhandled) {
                    window.onrejectionhandled(promise);
                }
            };
        }
        return function triggerHandled(promise) {
            process.emit('rejectionHandled', promise);
        };
    })();
    var asap = (function() {
        if (typeof setImmediate === 'function') {
            return setImmediate;
        }
        return setTimeout;
    })();
    function callThenable(thenable, onFulfill, onReject) {
        var then;
        try {
            then = thenable.then;
            then.call(thenable, onFulfill, onReject);
        } catch (e) {
            onReject(e);
        }
    }
    function isThenable(object) {
        if (object) {
            return typeof object.then === 'function';
        }
        return false;
    }
    function bindAndOnce(fn, thisValue) {
        var called = false;
        return function boundAndCalledOnce() {
            if (called === false) {
                called = true;
                return fn.apply(thisValue, arguments);
            }
        };
    }
    function noop() {}

    function Thenable(executor) {
        if (arguments.length === 0) {
            throw new Error('missing executor function');
        }
        if (typeof executor !== 'function') {
            throw new TypeError('function expected as executor');
        }

        this.status = 'pending';

        if (executor !== noop) {
            try {
                executor(
                    bindAndOnce(resolveThenable, this),
                    bindAndOnce(rejectThenable, this)
                );
            } catch (e) {
                rejectThenable.call(this, e);
            }
        }
    }
    Thenable.prototype = {
        constructor: Thenable,
        unhandledTriggered: false,
        handled: false,
        toString: function() {
            return '[object Thenable]';
        },
        then: function(onFulfill, onReject) {
            if (onFulfill && typeof onFulfill !== 'function') {
                throw new TypeError('then first arg must be a function ' + onFulfill + ' given');
            }
            if (onReject && typeof onReject !== 'function') {
                throw new TypeError('then second arg must be a function ' + onReject + ' given');
            }

            var thenable = new this.constructor(noop);
            var handler = {
                thenable: thenable,
                onFulfill: onFulfill || null,
                onReject: onReject || null
            };
            handle(this, handler);
            return thenable;
        },
        'catch': function(onReject) {
            return this.then(null, onReject);
        }
    };
    function resolveThenable(value) {
        try {
            if (isThenable(value)) {
                if (value === this) {
                    throw new TypeError('A promise cannot be resolved with itself');
                } else {
                    this.status = 'resolved';
                    this.value = value;
                    callThenable(
                        value,
                        bindAndOnce(resolveThenable, this),
                        bindAndOnce(rejectThenable, this)
                    );
                }
            } else {
                this.status = 'fulfilled';
                this.value = value;
                settleThenable(this);
            }
        } catch (e) {
            rejectThenable.call(this, e);
        }
    }
    function rejectThenable(value) {
        this.status = 'rejected';
        this.value = value;
        settleThenable(this);
    }
    function settleThenable(thenable) {
        if (thenable.status === 'rejected' && thenable.handled === false) {
            asap(function() {
                if (!thenable.handled) {
                    triggerUnhandled(thenable.value, thenable);
                    thenable.unhandledTriggered = true;
                }
            });
        }

        var hasPendingList = thenable.hasOwnProperty('pendingList');
        if (hasPendingList) {
            var pendingList = thenable.pendingList;
            var i = 0;
            var j = pendingList.length;
            while (i < j) {
                handle(thenable, pendingList[i]);
                i++;
            }
            // on peut "supprimer" pendingList mais
            pendingList.length = 0;
        }
    }
    function handle(thenable, handler) {
        // on doit s'inscrire sur la bonne pendingList
        // on finis forcément par tomber sur un thenable en mode 'pending'
        while (thenable.status === 'resolved') {
            thenable = thenable.value;
        }
        if (thenable.unhandledTriggered) {
            triggerHandled(thenable);
        }
        thenable.handled = true;

        if (thenable.status === 'pending') {
            if (thenable.hasOwnProperty('pendingList')) {
                thenable.pendingList.push(handler);
            } else {
                thenable.pendingList = [handler];
            }
        } else {
            asap(function() {
                var isFulfilled = thenable.status === 'fulfilled';
                var value = thenable.value;
                var callback = isFulfilled ? handler.onFulfill : handler.onReject;

                if (callback !== null) {
                    try {
                        value = callback(value);
                    } catch (e) {
                        isFulfilled = false;
                        value = e;
                    }
                }

                var sourceThenable = handler.thenable;
                if (isFulfilled) {
                    resolveThenable.call(sourceThenable, value);
                } else {
                    rejectThenable.call(sourceThenable, value);
                }
            });
        }
    }

    Thenable.resolve = function resolve(value) {
        if (arguments.length > 0) {
            if (value instanceof this && value.constructor === this) {
                return value;
            }
        }

        return new this(function resolveExecutor(resolve) {
            resolve(value);
        });
    };
    Thenable.reject = function reject(value) {
        return new this(function rejectExecutor(resolve, reject) {
            reject(value);
        });
    };
    Thenable.all = function all(iterable) {
        return new this(function allExecutor(resolve, reject) {
            var index = 0;
            var length = 0;
            var values = [];
            var resolveOne = function(value, index) {
                if (isThenable(value)) {
                    callThenable(value, function(value) {
                        resolveOne(value, index);
                    }, reject);
                } else {
                    values[index] = value;
                    length--;
                    if (length === 0) {
                        resolve(values);
                    }
                }
            };

            forOf(iterable, function(value) {
                length++;
                resolveOne(value, index);
                index++;
            });

            if (length === 0) {
                resolve(values);
            }
        });
    };
    Thenable.race = function race(iterable) {
        return new this(function(resolve, reject) {
            forOf(iterable, function(thenable) {
                thenable.then(resolve, reject);
            });
        });
    };

    
    if (!global.Promise) {
        global.Promise = Thenable;
    }
})(typeof window === 'undefined' ? global : window);
