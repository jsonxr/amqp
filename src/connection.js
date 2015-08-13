'use strict';

var amqp = require('amqp');
var assert = require('assert');
var async = require('async');
var events = require('events');
var Q = require('q');
var logger = require('./logger');


var EventEmitter = events.EventEmitter;
var DEFAULT_TIMEOUT_MS = 60000;
var DEFAULT_RETRY_COUNT = 10;
var DEFAULT_RETRY_DELAY_MS = 60000;
var CONNECT_TIMEOUT_MS = 30000;

function getIntWithDefault(value, defaultInt) {
  if (value) {
    value = parseInt(value, 10);
  }
  if (typeof value === 'number') {
    return value;
  } else {
    return defaultInt;
  }
}


/**
Simplified AMQP exchange handling. Supports retries
*/
function Connection(options) {
  var me = this;
  // Configure default options
  options = options || {};
  options.url = options.url || 'amqp://localhost';
  options.name = options.name || 'amqp-simple';
  options.connectionTimeout = options.connectionTimeout || CONNECT_TIMEOUT_MS;
  me.logger = logger(options.logger);
  me.options = options;
  // Send some events
  me._ee = new EventEmitter();
}

Connection.prototype.open = function open(callback) {
  var me = this;
  var deferred;
  
  if (! callback) {
    deferred = Q.defer();
  }
  me.logger.info('amq-simple: connecting to ' + me.options.url);
  me._connection = amqp.createConnection(me.options);
  
  // Handle ready as a success
  me._connection.once('ready', function () {
    me.connected = true;
    _onready(me, callback, deferred);
  });
  me._connection.on('basicQosOk', function (data) {
    console.log('basicQosOk: ', data);
  })
  // Handle error as failure
  me._connection.on('error', function (err) {
    if (! me.connected) {
      _onerror(me, callback, deferred, err);
    } else {
      me.logger.error('amq-simple: connection.onerror');
      console.dir(err);
      me.logger.error(err);
    }
  });

  if (! callback) {
    return deferred.promise;
  }
  
}


// Create exchange on amqp server
function _createExchange(me, name, callback) {
  me.logger.debug('amq-simple: creating exchange ' + name);
  return me._connection.exchange(name, { 
    type: 'direct',
    durable: true, 
    autoDelete: false,
    confirm: true
  });
}



function _onready(me, callback, deferred) {
  me.logger.info('amq-simple: connected to ' + me.options.url);
  
  me._exchange = _createExchange(me, me.options.name);
  me._exchange.on('open', function () {
    me.logger.debug('amq-simple: ' + me.options.name + ' exchange open');
  });
  me._deadExchange = _createExchange(me, me.options.name + '.dead');
  me._deadExchange.on('open', function () {
    me.logger.debug('amq-simple: ' + me.options.name + '.dead exchange open');
  })
  
  if (callback) {
    callback();
  } else {
    deferred.resolve();
  }
}

function _onerror(me, callback, deferred, err) {
  me.logger.error('amq-simple: ' + me.options.url + ' error.');
  me.logger.error(err);

  if (callback) {
    callback(err);
  } else {
    deferred.reject(err);
  }
}

Connection.prototype.close = function close(callback) {
  var me = this;
  me._connection.removeAllListeners('error');
  me._connection.disconnect();
  // disconnect doesn't work quite right in the amqp module
  if (callback) {
    callback();
  }
}


Connection.prototype._bindToQueue = function _bindToQueue(exchange, 
    queue, routingKey, callback) 
{
  var me = this;
  me.logger.debug('amqp-simple: _bindToQueue(exchange, "' + queue + '", "' + 
      routingKey + '")');
  // Create the dead letter queue
  me._connection.queue(queue, {
    durable: true,
    autoDelete: false
  }, function (q) {
    q.bind(exchange, routingKey, function () {
      me.logger.debug('amqp-simple: bound ' + queue + ' with ' + routingKey);
      if (callback) {
        callback(null, q);
      }
    });
  });
}

/**
routingKey: kinda like the message name
queue: This is the consumer
*/
Connection.prototype.subscribe = function subscribe(options, callback) {
  var me = this;
  // Assert what we believe to be true
  assert(options.routingKey, 'routingKey is required.');
  assert(options.consumer, 'consumer is required');
  assert(options.handler, 'handler is required');
  assert(me._deadExchange);
  assert(me._exchange);
  // Convenience variables
  var routingKey = options.routingKey;
  var consumer = options.consumer;
  var handler = options.handler;
  // Must handle message in this amount of time by default
  handler.timeout = options.timeout || DEFAULT_TIMEOUT_MS;
  
  //me._bindToQueue(me._deadExchange, 'dead.' + consumer, routingKey);
  me._bindToQueue(me._exchange, consumer, routingKey, function (err, q) {
    // Catch all messages for the routingKey
    var s = q.subscribe({
      ack: true,
      prefetchCount: 0 // 1
    }, function (body, headers, deliveryInfo, ack) {
      me.logger.debug('amq-simple: received message for ' + 
          deliveryInfo.routingKey);
      var msg = {
        body: body,
        headers: headers,
        routingKey: deliveryInfo.routingKey
      }
      me.logger.debug(msg);
      me._amqpHandleMessage(msg, me._exchange, me._deadExchange, ack, handler);
    }).addCallback(function subscribed(ok){
      if (callback) {
        callback();
      }
    });
  });
  
}

// Publish a message to the amqp server
Connection.prototype._amqpPublish = function _amqpPublish(options, callback) {
  var me = this;

  var exchange = options.exchange;
  var routingKey = options.routingKey;
  var body = options.body;
  var msgOptions = options.options;
  
  var payload = JSON.stringify(body);
  msgOptions.contentType = 'application/json';

  me.logger.debug('amqp-simple: _amqpPublish for ' + routingKey);
  me.logger.debug({
    body: options.body,
    headers: options.options.headers
  });
  
  exchange.publish(routingKey, payload, msgOptions, {
    mandatory: true,
    deliveryMode: 2,
    immediate: true
  });
  /**
  It is not calling the callback even though exchange is set to confirm mode
  */
  // }, function(isError, error) {
  //   console.log('published message JAOSN WAS HERE')
  //   if (isError) {
  //     callback(error);
  //   } else {
  //     callback();
  //   }
  // });
  callback();
}

// Retries sending a message decrementing the retry-count
Connection.prototype._amqpRetryMessage = function retryMessage(exchange, 
    deadExchange, msg, callback) 
{
  var me = this;
  var headers = msg.headers;
  var retryCount = getIntWithDefault(headers['x-retry-count'], 10);
  me.logger.debug('amqp-simple: retries left for ' + msg.routingKey + ': ' + retryCount);
  
  var retryDelay = getIntWithDefault(headers['x-retry-delay-ms'], 60000);

  var payload = JSON.stringify(msg.body);
  
  // If there are still retries left, retry this message
  var theExchange = exchange;
  if (retryCount > 0) {
    msg.headers['x-retry-count'] = retryCount - 1;
  } else {
    // No more retries available, send to the dead exchange
    me.logger.debug('amqp-simple: routing to dead exchange: ' + deadExchange);
    retryDelay = 0;
    theExchange = deadExchange;
  }
  
  setTimeout(function () {
    var options = {
      headers: msg.headers
    };
    me._amqpPublish({
      exchange: theExchange, 
      routingKey: msg.routingKey, 
      body: msg.body,
      options: options
    }, callback);
  }, retryDelay);
  
}

Connection.prototype._amqpHandleMessage = function handleMessage(msg, exchange, 
    deadexchange, ack, handler) 
{
  // This is the callback that was passed into the subscribe method
  // If the callback returns an error, we go through the retry process
  var me = this;
  msg.headers = _setDefaultHeaders(msg.headers);

  function retry() {
    me._amqpRetryMessage(exchange, deadexchange, msg, function (err) {
      me.logger.debug('amqp-simple: ack message after retry');
      me.logger.debug(msg);
      ack.acknowledge(false); // only ack this one message
    });
  }
  
  // This will handle cases where a consumer has an error inside one of their
  // callbacks.
  var timeout = handler.timeout || DEFAULT_TIMEOUT_MS;
  var timer = setTimeout(function () {
    me.logger.debug('amqp-simple: time out reached for '+ msg.routingKey, msg);
    retry();
  }, timeout);

  try {
    handler(msg, function (err) {
      clearTimeout(timer); // Handler returned in time so kill timer
      if (err) {
        me.logger.error('amqp-simple: error returned from client handler for ' + msg.routingKey)
        me.logger.error(err);
        retry();
      } else {
        // succeeded, so just ack the message
        me.logger.debug('amqp-simple: ack message after success');
        ack.acknowledge(false); // only ack this one message
      }
    });
  } catch(e) {
    // This will handle an exception in a consumer callback
    me.logger.error('amqp-simple: exception in client handler');
    me.logger.error(e);
    retry();
  }
}

function _setDefaultHeaders(headers) {
  headers = headers || {};

  function _setDefaultHeader(headers, name, defaultInt) {
    headers[name] = getIntWithDefault(headers[name], defaultInt);
  }
  
  _setDefaultHeader(headers, 'x-retry-count', DEFAULT_RETRY_COUNT);
  _setDefaultHeader(headers, 'x-retry-delay-ms', DEFAULT_RETRY_DELAY_MS);
  _setDefaultHeader(headers, 'x-timeout-ms', DEFAULT_TIMEOUT_MS);
  return headers;
}


/**
Publish a message to a queue

@param routingKey - Think of this as a queue that holds the messages
@param body - This is the json object to be sent
@param options - [optional] { headers: { 'x-retry-count': 1, 'x-retry-delay': 60 } }
@param callback - [optional] *might be called when the message was successfully published.
            Think there is a bug here
*/
Connection.prototype.publish = function (options, callback) {
  var me = this;
  // Assert what we believe to be true
  assert(options);
  assert(options.routingKey);
  assert(options.body);
  me.logger.debug('amqp-simple: Connection.publish('+options.routingKey+')');

  var deferred;
  if (!callback) {
    deferred = Q.defer();
  }
  
  options.headers = options.headers || {};

  var payload = JSON.stringify(options.body);
//  options.contentType = 'application/json';

  me._amqpPublish({ 
    exchange: me._exchange,
    routingKey: options.routingKey,
    body: options.body,
    options: {
      headers: options.headers,
    }
  }, function (err) {
    // Logging
    if (err) {
      me.logger.error('amqp-simple: error publishing message for ' + 
          options.routingKey);
      me.logger.error(err);
    } else {
      me.logger.debug('amqp-simple: finished publishing message for ' + 
          options.routingKey);
    }
    // notify caller
    if (callback) {
      callback(err);
    } else {
      if (err) {
        deferred.reject(err);
      } else {
        deferred.resolve();
      }
    }
  });

  if (!callback) {
    deferred.promise;
  }
}

module.exports = Connection;
