var assert = require('assert');
var amqp = require('../src');

describe("amqp-simple - promise API", function () {
  
  var connection;
  
  before(function (done) {
    connection = new amqp.Connection({ 
      url: 'amqp://dockerhost',
      logger: function () {} // ignore all logging
    });
    connection.open()
      .then(function () {
        done();
      }, function (err) {
        done(err);
      })
  });
  
  after(function () {
    if (connection) {
      connection.close();
    }
  })
    
  xit("should send a message", function (done) {
    assert(false);
    done();
  });
  
  xit("should receive a message", function (done) {
    assert(false);
    done();
  });

});


