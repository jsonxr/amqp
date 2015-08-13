var amqp = require('amqp');
var events = require('events');
var Q = require('q');

var EventEmitter = events.EventEmitter;


// Create exchange on amqp server
function createExchange(connection, name, callback) {
  connection.exchange(name, { 
    durable: true, 
    autoDelete: false,
    confirm: true
  }, function (exchange) {
    callback(null, exchange);
  });
}

/**
Simplified AMQP exchange handling. Supports retries
*/
function Exchange(options) {
  var me = this;
  // Configure default options
  options = options || {};
  options.url = options.url || 'amqp://localhost';
  options.name = options.name || 'amqpsimple';
  options.connectionTimeout = options.connectionTimeout || 30000;
  me.logger = getLogger(options.logger);
  me.options = options;
  // Send some events
  me._ee = new EventEmitter();
}

Exchange.prototype.connect = function connect(callback) {
  var me = this;
  var deferred;
  
  if (! callback) {
    deferred = Q.defer();
  }
  me.logger.info('connect to ');
  me.logger.info(JSON.stringify(me.options));
  me._connection = amqp.createConnection(me.options);
  // Handle ready as a success
  me._connection.on('ready', function (data) {
    me.logger.info('ready!')
    if (callback) {
      callback(null, data);
    } else {
      me.logger.info('calling resolve')
      deferred.resolve(data);
    }
  });
  // Handle error as failure
  me._connection.once('error', function (err) {
    me.logger.error(err);
    me.logger.error('err!')
    if (callback) {
      callback(err);
    } else {
      deferred.reject(err);
    }
  });

  if (! callback) {
    me.logger.info('return promise')
    return deferred.promise;
  }
  
}

Exchange.prototype.disconnect = function disconnect() {
  var me = this;
  me._connection.disconnect();
}

module.exports = {
  Exchange: Exchange
};
