# context-log
Http logging middleware for node.js (based upon log4js).

Funtionality:
 - Works like morgan to log http requests/responses.
 - Uses a uuid to tie together all log entries for a particular request.
 - Caches last log entries for programatic access.
 - Makes use of flow-context headers.
 - Enforces a log property dictionary.
 - Built on top of log4js.

## Usage
##### app.js
```js
var contextLog = require('context-log');
app.use(contextLog.setup({appName:"MyApp"}));
```
##### routes/index.js
```js
var contextLog = require('context-log');
router.get('/', function (req, res, next) {
    // Get the logger object
    var logger = contextLog.getLogger(req);    
    // Log something
    logger.info({action: "Hello world"});
    res.render('index');
});
```

##### log/MyApp.log
```
2016-08-09T18:42:22.022+0100, MyApp, INFO action="Http request", FCID=2dd85d0b-59f0-4f9e-9a9b-ed8367a248a9, url=/, httpMethod=GET, MyApp_httpVersion=1.1, hostSrc=::1
2016-08-09T18:42:22.027+0100, MyApp, INFO action="Hello world", FCID=2dd85d0b-59f0-4f9e-9a9b-ed8367a248a9
2016-08-09T18:42:22.430+0100, MyApp, INFO action="Http response", FCID=2dd85d0b-59f0-4f9e-9a9b-ed8367a248a9, httpCode=304, duration=408.88
```

## API

### setup(options)

Create a new context-log logger middleware function using the given `options`.

#### Options

context-log accepts these properties in the options object.

##### headerName

Each incoming request has a unique identifier generated for it, which is 
used on all subsequent log entries that result from handling the request.
If this option is provided, then its value will be used for the identifier 
instead of generating one. This allows for coupled components to track transactions
across the entire system.

##### appName

The term that starts each log line, and which is prepended to all log properties 
that can't be found in the dictionary.

With `{appName:"MyApp"}`, a log entry with `msg` and `flavour` properties 
would be created as:
```
2016-08-04T17:30:44.863+0100, MyApp, INFO msg="Cheese is tasty", MyApp_flavour="Cheddar"
```
Defaults to `Application`.

##### logDir

The directory into which the logs will be created. If not present, an attempt 
will be made to create it.

This property is ignored if `logConfig` is provided.

Defaults to `./log`.

##### logMaxSize

The maximum log file size before rollover occurs.

This property is ignored if `logConfig` is provided.

Defaults to `1e6`.

##### cacheMaxSize
The maximum number of a requests to cache log entries for. This can be managed dynamically using getCacheSizeMax() and setCacheSizeMax().
Defaults to 100.

##### suppressDictionaryWarnings
When a property is logged, it's name should ideally come from the dictionary. If it doesn't, then on its first use, a warning log line will be created. To suppress these warnings, set this property value to `true`.
Defaults to `false`.

##### logConfig

This option allows a log4js configuration file to be used directly. 
It containes two sub-elements:

###### file
The path to the log4js configuration file (json).
###### category
The category specified in the configuration file that the context-log library 
should use.

If the configuration file looked like this:
```js
{
  "appenders": [
    {
      "type": "console",
      "layout": {
        "type": "pattern",
        "pattern": "%d{yyyy-MM-ddThh:mm:ss.SSSO}, %c, %p %m"
      }
    },
    {
      "type": "file",
      "filename": "/var/log/log_file.log",
      "maxLogSize": 20480,
      "category": "myLogger"
    }
  ]
}
```
then the `category` property should be set to `"myLogger"`.

##### propertyDictionary
Defines the dictionary of property names to be used by context-log. Each log entry is generated in the form of `property1=value1,property2=value2,...`. Any property name that is not found in the dictionary, is prepended with the `appname`.
 
May be either an array, or the path to a file containing the dictionary.
i.e. `["msg", "action", "code"]` or `"dictionary.txt"` where the file
containes one item per line.

Defaults to `["contextId","url","method","version","userAgent","rqstAddr","contentType","statusCode","respTime","contentLength","frequency","action","msg"]`.

##### requestProperties
This determines what properties get logged every time a http request is received.

Default value :
```js
{
    contextId:"contextId"
    ,url:"url"
    ,method:"method"
    ,version:"version"
    ,userAgent:"userAgent"
    ,rqstAddr:"rqstAddr"
    ,contentType:["rqstHeader", "content-type"]
 }
```
 
The property names (i.e. `contextId`) should be taken from the dictionary. 
The values should refer to tokens - see below.

##### responseProperties
This determines what properties get logged every time a response is made 
to a http request.

Default value :
```js
{
    contextId:"contextId"
    ,statusCode:"statusCode"
    ,respTime:"respTime"
    ,contentLength:["respHeader", "content-length"]
    }
```
 
The property names (i.e. `contextId`) should be taken from the dictionary. 
The values should refer to tokens - see below.

#### tokens
Each token represents a property of a http interaction. Some need a second parameter to be useful.
For instance, using `respHeader` means that you also need to supply the name of the header. In this case, the name of the token and the second parameter are supplied in an array.

##### contextId
A unique identifier that is used to tie together all log entries for a particular request.
##### method
The http method of the request (GET, POST, PUT, etc)
##### respHeader
The value of the named response header. i.e. ["respHeader", "content-length"]
##### respTime
The response time, in ms. The second parameter might be used to limit the number of decimal places used (defaults to 3)
##### rqstHeader
The value of the named request header. i.e. ["rqstHeader", "content-type"]
##### rqstAddr
The address of the client making the call
##### statusCode
The http status code. i.e. 200, 404,...
##### url
The http url used to make the request
##### userAgent
The 'user-agent' request header
##### version
The http version.

### getLogger([req])
Gets an object that can be used to create log entries. If the request object, `req`, is passed in, then all log entries will share the same contextId. Otherwise, a new contextId will be generated.
#### req
Express [request](http://expressjs.com/en/api.html#req) object.

The returned object provides the following functions:
##### trace(properties)
Creates a TRACE level log entry with the given `properties`. These properties will be expressed to the log file in the form `name1=value1,name2=value2,...`. Any values that contain spaces will be enclosed in quotes. Any names that do not appear in the dictionary will be prefixed by the name of the application.
##### debug(properties)
Creates a DEBUG level log entry with the given `properties`. See above. 
##### info(properties)
Creates an INFO level log entry with the given `properties`. See above. 
##### warn(properties)
Creates a WARN level log entry with the given `properties`. See above. 
##### error(properties)
Creates an ERROR level log entry with the given `properties`. See above. 
##### getContextId()
Returns the value of the contextId for this logging object instance.

### getLogLevel()
Returns the log level ('trace', 'debug', 'info', 'warn' or 'error').

### setLogLevel(level)
Sets the log level.

### getCachedList([property])
Returns an array of objects that represent a group of log entries that all share the same contextId. 
For instance, if 2 incoming http requests were to be received by the system that each generated 10 seperate log entries each, then this function would return two elements.
The array returned would contain objects with two properties:
#### contextId
The contextId for the log entries
#### [property]
All of the log entries for the particular contextId would be scanned until one is found that contains the property whose name matches `property`. For instance, if the function was called like this `getCachedList('url')`, then the result would look like this:
```js
[
    {
        contextId:"774097f1-af08-44ca-9d58-92931c7096ca",
        url:"/"
    },
    {
        contextId:"4142706b-59cc-449c-9fd7-1d5ae9ba0e40",
        url:"/users"
    }
 ]
```

### getCachedDetails(contextId)
Gets all cached log entries for the given contextId. 
Returns an array of objects in this form:
```js
[
    {
        level:"info",
        properties:{
            ...
        },
        datetime: Tue Aug 09 2016 21:21:15 GMT+0100 (BST)
    },
    ...
 ]
```

### getCachedMaxSize()
Returns the maximum size of the cache. This is the maximum number of log entry collections to retain. Each collection is for a unique contentId.

### setCachedMaxSize(cacheMaxSize)
Sets the maximum number of log entry collections to retain.
