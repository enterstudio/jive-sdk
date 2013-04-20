/**
 * Test server that accepts inter-process communication to modify its endpoints.
 */
var express = require('express'),
    routes = require('./testroutes'),
    http = require('http'),
    jive = require('../../jive-sdk'),
    uuid = require('node-uuid');

// "Private" variables
var forkedProcess = typeof process.send !== 'undefined';
var config = null; //Configuration passed in from the parent process
var server = null; //The node server object

//Setup app
var app = express();
app.use(express.bodyParser());
app.use(express.logger('dev'));
app.use(express.methodOverride());
app.use(app.router);
app.configure('development', function () {
    app.use(express.errorHandler());
});

if (forkedProcess) {
    process.on('message', function(m) {
    //   console.log("Test server received message from test runner");
    //   console.log(m);

        if (m['pleaseStart'] === true) {
            startServer(m.config);
        }

        if (m['pleaseStop'] === true) {
            stopServer(m.id);

        }

        if ( m['operation'] ) {
            doOperation( m['operation'] );
            process.send({
                operationSuccess: true,
                id: m.id
            });
        }
    });
}
else {
    config = {
        'port' : 8096,
        'clientUrl' : 'http://localhost'
    };
    startServer(config);
}

function startServer(configuration) {
    config = configuration;
    if (configuration.integrationServer===true) {
        setupIntegration(configuration);
    }
    if (configuration.mockJiveId===true) {
        setupMockJiveId(configuration);
    }

    server = http.createServer(app);
    server.listen(configuration.port, function () {
        console.log("Test server '" + configuration['serverName'] + "' listening on port " + configuration.port);
        if (forkedProcess) {
            process.send( {serverStarted: true});
        }
    } );
}

function stopServer(id) {
    server.on('close', function() {
        console.log("Server at port " + config.port + " stopped");
        process.send({
            serverStopped: true,
            id: id
        });
        process.exit();
    })
    server.close();

}

/**
 * Sample operation JSON:
 * {
 *     "type" : "setEndpoint",
 *     "method" : "GET",
 *     "path" : "/test",
 *     "statusCode" : 200,
 *     "body" : "<html><body>Test endpoint body</body></html>"
 *     "headers" : { "Content-Type": "application/json" }
 *
 * }
 * @param operation
 */
function doOperation( operation ) {
    var type = operation['type'];
    if (type == "setEndpoint") {
        var method = operation['method'];
        var path = operation['path'];
        var statusCode = operation['statusCode'];
        var body = operation['body'];
        var headers = operation['headers'];

        setEndpoint(method, path, statusCode, body, headers);
    }
    else if (type == "setEnv") {
        var env = operation['env'];
        for (var key in env){
            process.env[key] = env[key];
        }
    }
}

function setEndpoint(method, path, statusCode, body, headers) {
    //Default header with json content type
    if (!headers || headers.length <= 0) {
        headers = {"Content-Type": "application/json"};
    }
    if (method.toUpperCase() == "GET") {
        app.get( path, function( req, res ) {
            res.writeHead(statusCode, headers);
            res.end(body );
        } );
    }
    if (method.toUpperCase() == "POST") {
        app.post( path, function( req, res ) {
            res.writeHead(statusCode, headers);
            res.end(body );
        } );
    }
    if (method.toUpperCase() == "PUT") {
        app.put( path, function( req, res ) {
            res.writeHead(statusCode, headers);
            res.end(body );
        } );
    }
    if (method.toUpperCase() == "DELETE") {
        app.delete( path, function( req, res ) {
            res.writeHead(statusCode, headers);
            res.end(body );
        } );
    }
}

exports.server = function() {
    return server;
};

function setupIntegration(configuration) {

    jive.service.options = configuration;

// Setup the tile configuration UI route at [clientUrl]:[port]/configure (eg. http://yoursite:8090/configure):
    app.get( '/configure', function( req, res ) {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end( "<script>jive.tile.onOpen(function() { jive.tile.close({'config':'value'});});</script>" );
    } );

// Setup the tile registration route at [clientUrl]:[port]/registration (eg. http://yoursite:8090/registration):
    app.post( '/registration', jive.routes.registration );

// For development, you may also setup useful dev endpoints to show what tiles are available on your service;
// for installing tiles on a jive instance
    app.get( '/tiles', jive.routes.tiles );
    app.get( '/tilesInstall', jive.routes.installTiles );

//
// Your tile must also declare metadata about itself, permitting the Jive instance to discover
// what type of type style it is, icons, and also the aforementioned required endpoints (configuration
// and registration).
//
    var definition = {
        "sampleData": {"title": "Account Details",
            "contents": [
                {
                    "name": "Value",
                    "value": "Initial data"
                }
            ]},
        "config": "/configure",
        "register": "/registration",
        "displayName": "Table Example",
        "name": "sampletable",
        "description": "Table example.",
        "style": "TABLE",
        "icons": {
            "16": "http://i.cdn.turner.com/cnn/.e/img/3.0/global/header/hdr-main.gif",
            "48": "http://i.cdn.turner.com/cnn/.e/img/3.0/global/header/hdr-main.gif",
            "128": "http://i.cdn.turner.com/cnn/.e/img/3.0/global/header/hdr-main.gif"
        }
    };

// Make this definition known to your service by calling the .save function as demonstrated below:
    jive.tiles.definitions.save(definition);
}


function setupMockJiveId(conf){

    var allowedAuthzCode = null;

    if (conf.allowedAuthzCode) {
        allowedAuthzCode = conf.allowedAuthzCode;
    }

    app.post("/v1/oauth2/token", function(req, res) {

        var body = req.body;

        var requestCode = body['code'];

        //If we aren't requiring a particular authz code or the request supplied the correct one
        if (!allowedAuthzCode || allowedAuthzCode && requestCode == allowedAuthzCode) {

            var response = {
                "access_token": uuid.v4(),
                "token_type":"bearer",
                "refresh_token": uuid.v4(),
                "expires_in": 3599,
                "scope": require('./test-util').makeGuid(conf.clientUrl + (conf.port ? ":" + conf.port : ""), true, 1234),
                "state":null};

            res.writeHead(200, {"Content-Type": "application/json"});
            res.end(JSON.stringify(response));
        }
        else {
            res.writeHead(400, {"Content-Type": "application/json"});
            res.end(JSON.stringify({"error": "Invalid auth code " + requestCode}));
        }

    });

}
