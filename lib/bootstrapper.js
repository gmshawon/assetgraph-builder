var vm = require('vm'),
    _ = require('underscore'),
    uglifyJs = require('uglify-js-papandreou'),
    uglifyAst = require('uglifyast'),
    i18nTools = require('./i18nTools'),
    bootstrapper = module.exports = {};

// Maintained as a function so syntax highlighting works:
function bootstrapperCode() {
    window.INCLUDE = function () {};

    window.GETSTATICURL = function (url) { // , placeHolderValue1, placeHolderValue2, ...
        var placeHolderValues = Array.prototype.slice.call(arguments, 1);
        return url.replace(/\*\*?/g, function ($0) {
            return placeHolderValues.shift();
        });
    };

    var documentElement = document && document.documentElement,
        documentElementLang = documentElement && documentElement.getAttribute('lang');

    window.LOCALEID = documentElementLang || (window.SUPPORTEDLOCALEIDS && SUPPORTEDLOCALEIDS[0]) || window.DEFAULTLOCALEID || 'en_US';

    if ((!documentElement || !documentElementLang) && window.LOCALECOOKIENAME) {
        // Make sure that LOCALEID is correct in development mode:
        var matchLocaleCookieValue = document.cookie && document.cookie.match(new RegExp("\\b" + LOCALECOOKIENAME.replace(/[\.\+\*\{\}\[\]\(\)\?\^\$]/g, '\\$&') + "=([\\w]+)"));
        if (matchLocaleCookieValue) {
            var cookieLocaleId = matchLocaleCookieValue[1],
                isSupported = true; // Assume that all locales are supported if SUPPORTEDLOCALEIDS isn't defined

            if (window.SUPPORTEDLOCALEIDS) {
                isSupported = false;
                for (var i = 0 ; i < SUPPORTEDLOCALEIDS.length ; i += 1) {
                    if (SUPPORTEDLOCALEIDS[i] === cookieLocaleId) {
                        isSupported = true;
                        break;
                    }
                }
            }
            if (isSupported) {
                LOCALEID = cookieLocaleId;
            }
        }
    }

    // Set <html lang="..."> to the actual value so per-locale CSS can work, eg.: html[lang='en'] .myClass {...}
    if (!window.BUILDDEVELOPMENT && documentElement && documentElementLang !== LOCALEID) {
        documentElement.setAttribute('lang', LOCALEID);
    }

    // Helper for getting a prioritized list of relevant locale ids from a specific locale id.
    // For instance, "en_US" produces ["en_US", "en"]
    function expandLocaleIdToPrioritizedList(localeId) {
        if (!localeId) {
            return [];
        }
        var localeIds = [localeId];
        while (/_[^_]+$/.test(localeId)) {
            localeId = localeId.replace(/_[^_]+$/, '');
            localeIds.push(localeId);
        }
        return localeIds;
    }

    // Returns the canonical id of the best matching supported locale, or
    // false if no suitable supported locale could be found
    function resolveLocaleId(localeId) {
        localeId = localeId.replace(/-/g, '_'); // en-US => en_US
        for (var i = 0 ; i < SUPPORTEDLOCALEIDS.length ; i += 1) {
            var supportedLocaleId = SUPPORTEDLOCALEIDS[i];
            if (supportedLocaleId === localeId) {
                // Exact match
                return supportedLocaleId;
            }
        }
        // No exact match found, if the locale id contains variants, try looking for a more general variant:
        var prioritizedLocaleIds = expandLocaleIdToPrioritizedList(localeId);
        if (prioritizedLocaleIds.length > 1) {
            return resolveLocaleId(prioritizedLocaleIds[1]);
        }
        return false;
    };

    window.LOCALIZE = true;

    // Compute on the first use so the application has a chance to change LOCALEID before TR is used for the first time:
    var allKeysForLocale;
    function getAllKeysForLocale() {
        if (!allKeysForLocale) {
            allKeysForLocale = {};
            var prioritizedLocaleIds = expandLocaleIdToPrioritizedList(LOCALEID);
            for (var key in I18NKEYS) {
                if (I18NKEYS.hasOwnProperty(key)) {
                    for (var i = 0 ; i < prioritizedLocaleIds.length ; i += 1) {
                        if (prioritizedLocaleIds[i] in I18NKEYS[key]) {
                            allKeysForLocale[key] = I18NKEYS[key][prioritizedLocaleIds[i]];
                            break;
                        }
                    }
                }
            }
        }
        return allKeysForLocale;
    }

    window.TR = function (key, defaultValue) {
        return getAllKeysForLocale()[key] || defaultValue || '[!' + key + '!]';
    };

    window.TRPAT = function (key, defaultPattern) {
        var pattern = TR(key, defaultPattern);
        if (typeof pattern !== 'string') {
            throw new Error('TRPAT: Value must be a string: ' + pattern);
        }
        return function () { // placeHolderValue, ...
            var placeHolderValues = arguments;
            // FIXME: The real ICU syntax uses different escaping rules, either adapt or remove support
            return pattern.replace(/\{(\d+)\}|((?:[^\{\\]|\\[\\\{])+)/g, function ($0, placeHolderNumberStr, text) {
                if (placeHolderNumberStr) {
                    return placeHolderValues[placeHolderNumberStr];
                } else {
                    return text.replace(/\\([\\\{])/g, "$1");
                }
            });
        };
    };

    window.TRHTML = function (htmlString) {
        var div = document.createElement('div');
        div.innerHTML = htmlString;
        i18nTools.eachI18nTagInHtmlDocument(div, i18nTools.createI18nTagReplacer({
            allKeysForLocale: getAllKeysForLocale(),
            localeId: LOCALEID
        }));
        return div.innerHTML;
    };

    window.GETTEXT = function (url) {
        // Do a synchronous XHR in development mode:
        var xhr;
        try {
            xhr = new XMLHttpRequest();
        } catch (e) {
            try {
                xhr = new ActiveXObject('Microsoft.XmlHTTP');
            } catch (e) {}
        }
        if (!xhr) {
            throw new Error("GETTEXT: Couldn't initialize an XMLHttpRequest object.");
        }
        xhr.open('GET', url, false);
        xhr.send();
        if (xhr.status && xhr.status >= 200 && xhr.status < 400) {
            return xhr.responseText;
        } else {
            throw new Error("GETTEXT: Unexpected response from the server: " + (xhr && xhr.status));
        }
    };

    // Taken from jQuery 1.8.3:

    var isReady = false, // Is the DOM ready to be used? Set to true once it occurs.
        readyWait = 1, // A counter to track how many items to wait for before the ready event fires. See #6781
        readyList;

    // The ready event handler and self cleanup method
    function DOMContentLoaded() {
        if (document.addEventListener) {
            document.removeEventListener("DOMContentLoaded", DOMContentLoaded, false);
            ready();
        } else if (document.readyState === "complete") {
            // we're here because readyState === "complete" in oldIE
            // which is good enough for us to call the dom ready!
            document.detachEvent("onreadystatechange", DOMContentLoaded);
            ready();
        }
    }

    // Handle when the DOM is ready
    function ready(wait) {
        // Abort if there are pending holds or we're already ready
        if (wait === true ? --readyWait : isReady) {
            return;
        }

        // Make sure body exists, at least, in case IE gets a little overzealous (ticket #5443).
        if (!document.body) {
            return setTimeout(ready, 1);
        }

        // Remember that the DOM is ready
        isReady = true;

        // If a normal DOM Ready event fired, decrement, and wait if need be
        if (wait !== true && --readyWait > 0) {
            return;
        }

        if (readyList) {
            for (var i = 0 ; i < readyList.length ; i += 1) {
                readyList[i]();
            }
            readyList = [];
        }
    }

    function onReady(fn) {
        if (!readyList) {
            readyList = [];

            // Catch cases where $(document).ready() is called after the browser event has already occurred.
            // we once tried to use readyState "interactive" here, but it caused issues like the one
            // discovered by ChrisS here: http://bugs.jquery.com/ticket/12282#comment:15
            if (document.readyState === "complete") {
                // Handle it asynchronously to allow scripts the opportunity to delay ready
                setTimeout(ready, 1);

            // Standards-based browsers support DOMContentLoaded
            } else if (document.addEventListener) {
                // Use the handy event callback
                document.addEventListener("DOMContentLoaded", DOMContentLoaded, false);

                // A fallback to window.onload, that will always work
                window.addEventListener("load", ready, false);

            // If IE event model is used
            } else {
                // Ensure firing before onload, maybe late but safe also for iframes
                document.attachEvent("onreadystatechange", DOMContentLoaded);

                // A fallback to window.onload, that will always work
                window.attachEvent("onload", ready);

                // If IE and not a frame
                // continually check to see if the document is ready
                var top = false;

                try {
                    top = window.frameElement == null && document.documentElement;
                } catch(e) {}

                if (top && top.doScroll) {
                    (function doScrollCheck() {
                        if (!isReady) {
                            try {
                                // Use the trick by Diego Perini
                                // http://javascript.nwbox.com/IEContentLoaded/
                                top.doScroll("left");
                            } catch(e) {
                                return setTimeout(doScrollCheck, 50);
                            }

                            // and execute any waiting functions
                            ready();
                        }
                    })();
                }
            }
        }
        readyList.push(fn);
    }

    // Don't translate the document if we're running in jsdom (could be interesting at some point, though):
    if (window.setTimeout) {
        onReady(function () {
            i18nTools.eachI18nTagInHtmlDocument(document, i18nTools.createI18nTagReplacer({allKeysForLocale: getAllKeysForLocale()}));
        });
    }
}

bootstrapper.createAst = function (initialAsset, assetGraph, options) {
    options = options || {};
    if (initialAsset.type !== 'Html' && initialAsset.type !== 'JavaScript') {
        throw new Error('bootstrapper.createAst: initialAsset must be Html or JavaScript, but got ' + initialAsset);
    }
    var statementAsts = [],
        globalValueByName = {
            I18NKEYS: i18nTools.extractAllKeys(assetGraph)
        };

    // Add window.SUPPORTEDLOCALEIDS, window.DEFAULTLOCALEID, and window.LOCALECOOKIENAME if provided in the options object:
    ['supportedLocaleIds', 'defaultLocaleId', 'localeCookieName'].forEach(function (optionName) {
        if (options[optionName]) {
            globalValueByName[optionName.toUpperCase()] = options[optionName];
        }
    });

    Object.keys(globalValueByName).forEach(function (globalName) {
        statementAsts.push(['stat', ['assign', true, ['dot', ['name', 'window'], globalName],
                                     uglifyAst.objToAst(globalValueByName[globalName])]]);
    });

    statementAsts.push(['var', [['i18nTools', ['object', []]]]]);
    ['tokenizePattern', 'eachI18nTagInHtmlDocument', 'createI18nTagReplacer'].forEach(function (i18nToolsFunctionName) {
        statementAsts.push(['stat', ['assign', true, ['dot', ['name', 'i18nTools'], i18nToolsFunctionName],
                                     uglifyAst.objToAst(i18nTools[i18nToolsFunctionName])]]);
    });

    Array.prototype.push.apply(statementAsts, uglifyAst.getFunctionBodyAst(bootstrapperCode));

    // Wrap in immediately invoked function:
    return ['toplevel', [['stat', ['call', ['function', null, [], statementAsts]]]]];
};

bootstrapper.createContext = function (initialAsset, assetGraph, contextProperties) {
    var context = vm.createContext();
    context.window = context;
    context.assetGraph = assetGraph;
    if (contextProperties) {
        _.extend(context, contextProperties);
    }
    if (initialAsset.type === 'Html') {
        context.initialAsset = initialAsset;
        context.__defineSetter__('document', function () {});
        context.__defineGetter__('document', function () {
            initialAsset.markDirty();
            return initialAsset.parseTree;
        });
    }
    vm.runInContext(uglifyJs.uglify.gen_code(bootstrapper.createAst(initialAsset, assetGraph)),
                    context,
                    'bootstrap code for ' + (initialAsset.url || 'inline'));
    return context;
};