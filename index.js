'use strict'

/**
 * Module exports.
 * @public
 */

module.exports.setup = setup;
module.exports.getLogger = getLogger;

module.exports.setLogLevel = setLogLevel;
module.exports.getLogLevel = getLogLevel;

module.exports.getCachedList = getCachedList;
module.exports.getCachedDetails = getCachedDetails;
module.exports.getCachedMaxSize = getCachedMaxSize;
module.exports.setCachedMaxSize = setCachedMaxSize;

module.exports.getContextIdHeaderName = getContextIdHeaderName;

/**
 * Module dependencies.
 * @private
 */

var onFinished = require('on-finished')
    , uuid = require('uuid')
    , fs = require('fs')
    , mkdirp = require('mkdirp')
    , log4js = require('log4js')
    , stackTrace = require('stack-trace')
    , path = require('path')
;

/**
 * Private stuff
 */
var _options = null;                // Setup options
var _log4jsLogger = null;           // log4js object
var _initialised = false;           // log4js initialisation flag
var _levels = {trace: 0, debug: 1, info: 2, warn: 3, error: 4 };
var _logLevel = _levels.info;       // current log level
var _logsAwaitingInitialization;    // collection of log entries received before initialization complete
var _cacheMaxSize = 0;              // max cache size
var _nonDictionaryProperties = {};  // Collection of non-dictionary proeprties seen so far.
// cached details
var _logCacheDetails;               
var _logCacheIndex;

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//  P U B L I C    A P I
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Called from within Express route to create logging object
 * @param req
 * @returns {{trace: trace, debug: debug, info: info, warn: warn, error: error}}
 */
function getLogger(req){
    var contextId = req ? req._contextLog.contextId : uuid.v4();
    return {
        trace : function(properties){
            properties = addContextIdProperty(properties, contextId);
            addLogEntry(_levels.trace, properties);
        }
        ,debug : function(properties){
            properties = addContextIdProperty(properties, contextId);
            addLogEntry(_levels.debug, properties);
        }
        ,info : function(properties){
            properties = addContextIdProperty(properties, contextId);
            addLogEntry(_levels.info, properties);
        }
        ,warn : function(properties){
            properties = addContextIdProperty(properties, contextId);
            addLogEntry(_levels.warn, properties);
        }
        ,error : function(properties){
            properties = addContextIdProperty(properties, contextId);
            addLogEntry(_levels.error, properties);
        }
        ,getContextId : function(){
            return contextId;
        }
    }
}

/**
 * options = {
 *      headerName : "context-id"
 *      ,appName : "MyApp"
 *      ,logConfig: {
 *          file: "./log4js_configuration.json"
 *          ,category: "logger"
 *      }
 *      ,logDir : "./log"
 *      ,logMaxSize:1e6
 *      ,cacheMaxSize:100
 *      ,suppressDictionaryWarnings:false
 *      ,propertyDictionary: ["contentId","url","method","version","userAgent","rqstAddr","contentType","statusCode","respTime","contentLength","frequency",
 *          "action","msg"
 *          ]
 *      ,requestProperties:{
 *          contextId:"contextId"
 *          ,url:"url"
 *          ,method:"method"
 *          ,version:"version"
 *          ,userAgent:"userAgent"
 *          ,rqstAddr:"rqstAddr"
 *          ,contentType:["rqstHeader", "content-type"]
 *      }
 *      ,responseProperties:{
 *          contextId:"contextId"
 *          ,statusCode:"statusCode"
 *          ,respTime:"respTime"
 *          ,contentLength:["respHeader", "content-length"]
 *      }
 * }
 */

/**
 * Create a logger middleware.
 * 
 * @public
 * @param {Object} [options]
 * @return {Function} middleware
 */
function setup(options) {
    _options = options || {};

    var callingDir = getCallingDir();
    configure(callingDir);

    // Middleware method
    return function logger(req, res, next) {

        // Get contextId from req headers, or create one
        var contextId = req.get(getContextIdHeaderName());
        contextId = contextId || uuid.v4();

        var contextLogDetails = {contextId:contextId}

        // request data
        req._contextLog = res._contextLog = contextLogDetails

        // record details of request
        contextLogDetails.startAt = process.hrtime()

        // Log the request
        logRequest(req);

        // log when response finished
        onFinished(res, function(){
            var contextLogDetails = res._contextLog;
            contextLogDetails.hrDuration = process.hrtime(contextLogDetails.startAt)
            // Log the response
            logResponse(req, res);
        });

        next();
    };
}

/**
 * Gets the log level
 * @returns {*}
 */
function getLogLevel(){
    for (var name in _levels){
        if (_levels[name] == _logLevel)
            return name;
    }
}

/**
 * Sets the log level
 * @param level
 */
function setLogLevel(level){
    _logLevel = _levels.hasOwnProperty(level) ? _levels[level] : _levels.info;
}

/**
 * Gets the list of cached context ids
 */
function getCachedList(property){
    var list = [];
    if (!_logCacheIndex)
        return list;

    var contextIdProperty = _options.contextIdProperty;
    for (var i = 0; i < _logCacheIndex.length; i++){
        var detail = {contextId:_logCacheIndex[i]};
        list.push(detail);
        if (property){
            var logEntries = _logCacheDetails[_logCacheIndex[i]];
            for (var j = 0; j < logEntries.length; j++){
                var entry = logEntries[j];
                var prop = entry.properties[property];
                if (prop) {
                    detail[property] = prop;
                    break;
                }
            }
        }
    }

    return list
}

/**
 * Gets the cached log details for the given contextId
 * @param contextId
 */
function getCachedDetails(contextId){
    return _logCacheDetails[contextId] || [];
}

/**
 * Gets the maximum cache size
 * @returns {number}
 */
function getCachedMaxSize(){
    return _cacheMaxSize;
}

/**
 * Sets the maximum cache size
 */
function setCachedMaxSize(cacheMaxSize){
    _cacheMaxSize = cacheMaxSize;
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//  H T T P   R Q S T / R E S P   L O G G I N G
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Log the request
 * @param req
 */
function logRequest(req){
    addLogEntry(_levels.info, getHttpLogProperties(req, null, getRequestProperties()));
}

/**
 * Log the response
 * @param req
 * @param res
 */
function logResponse(req, res){
    addLogEntry(_levels.info, getHttpLogProperties(req, res, getResponseProperties()))
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//  S E T U P
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Configure the log4js obj
 */
function configure(callingDir){
    _cacheMaxSize = _options.cacheMaxSize || 0;
    setupLog4js(callingDir, function(){
        // If a file path was provided for the dictionary, then load that now
        loadDictionaryFromFile(function() {
            // Converts the array to a map (object properties) for faster lookup
            convertDictionaryToMap();
            // Extract the property used for the contextId, and remember this for later
            _options.contextIdProperty = getContextIdProperty(getRequestProperties());

            _initialised = true;

            _log4jsLogger.info("Logging Initialised");
        });
    });
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//  A D D I N G   L O G G I N G   E N T R I E S
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Writes a log entry to log4js if initialised, otherwise to cache for later writting upon initialization
 * @param level
 * @param text
 */
function addLogEntry(level, properties){
    // Add to cache if this functionality is wanted
    if (_options && _cacheMaxSize > 0)
        addToCache(level, properties);

    // If initialised, then write straight to log4js
    if (_initialised){
        // First write any entries that were waiting for initialisation
        if (_logsAwaitingInitialization)
            writeWaitingEntries();

        writeToLog4js(level, properties);
    } else {
        // If not yet initialised, then write to temp collection
        if (!_logsAwaitingInitialization)
            _logsAwaitingInitialization = [];
        _logsAwaitingInitialization.push({level:level, properties:properties});
    }
}

/**
 * Write entries that were waiting for log4js to be initialised
 */
function writeWaitingEntries(){
    var copy = _logsAwaitingInitialization;
    _logsAwaitingInitialization = undefined;

    for (var i = 0; i < copy.length; i++){
        var entry = copy[i];
        writeToLog4js(entry.level, entry.properties);
    }
}

/**
 * Writes to log4js
 * @param level
 * @param properties
 */
function writeToLog4js(level, properties){
    if (_initialised){
        // Check log level
        if (_logLevel > level)
            return;

        var text = generateLogLine(properties);
        switch(level){
            case _levels.trace :
                _log4jsLogger.trace(text); break;
            case _levels.debug :
                _log4jsLogger.debug(text); break;
            case _levels.info :
                _log4jsLogger.info(text); break;
            case _levels.warn :
                _log4jsLogger.warn(text); break;
            case _levels.error :
                _log4jsLogger.error(text); break;
        }
    } else {
        throw new Error("Attempting to write to unitialised log4js instance");
    }
}

/**
 * Adds an entry to the cache
 * @param level
 * @param properties
 */
function addToCache(level, properties){
    // Is caching enabled
    if (typeof properties === 'object' && _options && _cacheMaxSize > 0 && _options.contextIdProperty){
        // Get the context id
        var contextId = properties[_options.contextIdProperty];
        // Only interested in Express requests with context Id
        if (!contextId)
            return;

        if (!_logCacheDetails)
            _logCacheDetails = {};

        if (!_logCacheIndex)
            _logCacheIndex = [];

        var datetime = new Date();
        // Add to existing entry
        if (_logCacheDetails[contextId]){
            _logCacheDetails[contextId].push({level:level, properties:properties, datetime:datetime});
        } else {
            // If we're at our limit, then remove the oldest
            if (_logCacheIndex.length == _cacheMaxSize){
                var oldestContextId = _logCacheIndex.shift();
                delete _logCacheDetails[oldestContextId];
            }
            // Add to end of index
            _logCacheIndex.push(contextId);
            var collection = [];
            _logCacheDetails[contextId] = collection;
            collection.push({level:level, properties:properties, datetime:datetime});
        }
    }
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//  L O G   F O R M A T T I N G
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Get log properties for a http log entry
 * @param req
 * @param res
 * @param properties
 * @returns {string}
 */
function getHttpLogProperties(req, res, properties){
    if (!properties)
        return {};

    var logProperties = {};
    for (var propName in properties){
        var tokenName = properties[propName];
        var detail = null;
        var propValue = "";
        if (Array.isArray(tokenName)){
            detail = tokenName[1];
            tokenName = tokenName[0];
        }
        if (_tokens[tokenName]){
            propValue = _tokens[tokenName](req, res, detail);
            var property = getPropertyName(propName);
            logProperties[property] = propValue;
        } else {
            logProperties[propName] = tokenName;
        }
    }
    return logProperties;
}

/**
 * Generate log line from properties
 * @param properties
 * @returns {string}
 */
function generateLogLine(properties){
    if (typeof properties === 'string')
        return "\"" + properties + "\"";
    var text = "";
    for (var key in properties){
        var value = properties[key];
        text = addLogProperty(text, key, value);
    }
    return text;
}

/**
 * Add a property to the log line text
 * @param text
 * @param name
 * @param value
 * @returns {string|*}
 */
function addLogProperty(text, name, value){
    if (value == undefined)
        return text;
    if (text.length > 0)
        text += ", ";

    if (typeof value == 'string' && value.indexOf(' ') != -1){
        value = "\"" + value + "\"";
    }

    text += name + "=" + value;
    return text;
}

/**
 * Get a usable property name. If we're using the dictionary, and the property isn't in it, then prepend with the application name
 * @param name
 * @returns {*}
 */
function getPropertyName(name){
    if (_options.propertyDictionary){
        if (_options.propertyDictionary[name])
            return name;
        else {
            if (!suppressDictionaryViolationWarnings() && !_nonDictionaryProperties[name]){
                _log4jsLogger.warn("Non-Dictionary term used in logging: "+name);
                _nonDictionaryProperties[name] = true;
            }
            return getAppName() + "_" + name;
        }
    }
    return name;
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//  T O K E N S
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

// Collection of token extraction functions
var _tokens = {};
function token(name, fn){
    _tokens[name] = fn;
}

/**
 * Get the contextId
 */
token("contextId", function(req, res, detail){
    return req._contextLog.contextId;
});

/**
 * Get the httpMethod
 */
token("method", function(req, res, detail){
    return req.method;
});

/**
 * Get the response header
 */
token("respHeader", function(req, res, field){
    if (!res._header) {
        return undefined
    }

    // get header
    var header = res.getHeader(field)

    return Array.isArray(header)
        ? header.join(', ')
        : header
});

/**
 * Get the response time
 */
token("respTime", function(req, res, digits){
    var ns = req._contextLog.hrDuration[0] * 1e9 + req._contextLog.hrDuration[1];
    var duration = ns / 1e6;
    return duration.toFixed(digits === undefined ? 3 : digits)
});

/**
 * Get a request header
 */
token("rqstHeader", function(req, res, field){
    // get header
    var header = req.headers[field.toLowerCase()]

    return Array.isArray(header)
        ? header.join(', ')
        : header
});

token("rqstAddr", function(req, res, detail){
    return req.ip
        || (req.connection && req.connection.remoteAddress)
        || undefined;
});

token("statusCode", function(req, res, detail){
    return res._header
        ? String(res.statusCode)
        : undefined
});

token("url", function(req, res, detail){
    return req.originalUrl || req.url;
});

token("userAgent", function(req, res, detail){
    return req.headers['user-agent'];
});

token("version", function(req, res, detail){
    return req.httpVersionMajor + '.' + req.httpVersionMinor
});

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//  O P T I O N    P R O P E R T I E S
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Get the maximum log file size before role over
 * @returns {*|number}
 */
function getLogMaxSize(){
    return _options.logMaxSize || 1e6;
}

/**
 * Get the request properties
 * @returns {{contextId: string, url: string, method: string, version: string, userAgent: string, rqstAddr: string, contentType: string[]}|*}
 */
function getRequestProperties() {
    if (!_options.requestProperties)
        _options.requestProperties = {contextId: "contextId",url: "url",method: "method",version: "version",userAgent: "userAgent",rqstAddr: "rqstAddr",contentType: ["rqstHeader", "content-type"]};
    return _options.requestProperties;
}

/**
 * Get the response properties
 * @returns {{contextId: string, statusCode: string, respTime: string, contentLength: string[]}|*}
 */
function getResponseProperties() {
    if (!_options.responseProperties)
        _options.responseProperties= { contextId:"contextId",statusCode:"statusCode",respTime:"respTime",contentLength:["respHeader", "content-length"]};
    return _options.responseProperties;
}

/**
 * Get the application name
 * @returns {string|string|string}
 */
function getAppName(){
    return _options.appName || "Application";
}

/**
 * Gets the context id header name
 * @returns {*}
 */
function getContextIdHeaderName(){
    return _options ? _options.headerName || 'context-id' : 'context-id';
}

function suppressDictionaryViolationWarnings(){
    return _options.suppressDictionaryWarnings || false;
}

////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
//  O T H E R
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

/**
 * Converts the dictionary toa map which is more useful for searching
 */
function convertDictionaryToMap(){
    // Set a default if abset
    if (!_options.propertyDictionary)
        _options.propertyDictionary = ["contextId","url","method","version","userAgent","rqstAddr","contentType","statusCode","respTime","contentLength","frequency","action","msg"];

    if (Array.isArray(_options.propertyDictionary)){
        var map = {};
        for (var i = 0; i < _options.propertyDictionary.length; i++){
            map[_options.propertyDictionary[i]] = true;
        }
        _options.propertyDictionary = map;
    }
}

/**
 * Loads the property dictionary from file. Each line contains a property name
 */
function loadDictionaryFromFile(callback){
    if (!_options.propertyDictionary || typeof _options.propertyDictionary != "string"){
        callback();
    } else {
        var dictionaryArray = [];
        fs.readFile(_options.propertyDictionary, function(err, data){
            if (err){
                _log4jsLogger.error("Failed to load dictionary terms from file: "+_options.propertyDictionary);
            } else {
                var lines = data.toString().split("\n");
                for (var i = 0; i < lines.length; i++){
                    dictionaryArray.push(lines[i]);
                }
                _options.propertyDictionary = dictionaryArray;
            }
            callback();
        });
    }
}

/**
 * Finds the property name being used for the contextId
 * @param properties
 */
function getContextIdProperty(properties){
    if (properties === undefined || properties == null)
        return undefined;
    for (var key in properties){
        var value = properties[key];
        if (value == "contextId")
            return key;
    }
    return undefined;
}

/**
 * Sets up log4js
 * @param callback
 */
function setupLog4js(callingDir, callback){
    // First check that log dir exists
    var logFileDir = _options.logDir || './log';
    logFileDir = getAbsolutePath(callingDir, logFileDir);

    mkdirp(logFileDir, function (err){
        if (err){
            throw new Error("Failed to create logging directory: "+err.message);
        } else {
            // Create from config file
            if (_options.logConfig){
                var logConfigFile = _options.logConfig.file;

                logConfigFile = getAbsolutePath(callingDir, logConfigFile);
                log4js.configure(logConfigFile, {reloadSecs: 300});
                var category = _options.logConfig.category || getAppName();
                _log4jsLogger = log4js.getLogger(category);
            } else {
                // Create using predefined config
                log4js.configure({
                    appenders: [
                        {
                            type: 'console'
                            , layout: {
                                type: "pattern",
                                pattern: "%d{yyyy-MM-ddThh:mm:ss.SSSO}, %c, %p %m"
                            }
                        },
                        {
                            type: 'file'
                            ,filename: logFileDir + '/' + getAppName() +  '.log'
                            ,category: getAppName()
                            ,maxLogSize: getLogMaxSize()
                            , layout: {
                                type: "pattern",
                                pattern: "%d{yyyy-MM-ddThh:mm:ss.SSSO}, %c, %p %m"
                            }
                        }
                    ]
                });
                _log4jsLogger = log4js.getLogger(getAppName());
            }
            callback();
        }
    });
}

/**
 * Add the contextId to the properties
 * @param properties
 * @param contextId
 * @returns {*}
 */
function addContextIdProperty(properties, contextId){
    if (typeof properties === 'object' && _options && _options.contextIdProperty){
        properties[_options.contextIdProperty] = contextId;
    }
    return properties;
}

/**
 * Get the directory of the script that called this one
 * @returns {*}
 */
function getCallingDir(){
    var stackTraceObj = stackTrace.get();
    for (var i = 2; i < stackTraceObj.length; i++){
        var fileName = stackTraceObj[i].getFileName();
        if (fileName !== 'undefined')
            return path.dirname(fileName);
    }
    return ".";
}

/**
 * Gets an absolute path
 * @param callingDir
 * @param path
 * @returns {*}
 */
function getAbsolutePath(callingDir, filePath){
    if (filePath.indexOf("./") == 0){
        filePath = path.join(callingDir, filePath.substr(2))
    }
    return filePath;
}

