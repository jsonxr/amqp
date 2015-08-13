var assert = require('assert');
var fnLogger = require('../src/logger');

describe("amqp-simple - options.logger", function () {
  
  it("should honor function when calling logger.info", function (done) {
    var logger = fnLogger(function (str) {
      assert.equal(str, 'Hello');
      done();
    })
    logger.info('Hello');
  });
  
  it("should honor function when calling logger.error", function (done) {
    var logger = fnLogger(function (str) {
      assert.equal(str, 'Hello');
      done();
    })
    logger.error('Hello');
  });
  
  it("should honor function when calling logger.debug", function (done) {
    var logger = fnLogger(function (str) {
      assert.equal(str, 'Hello');
      done();
    })
    logger.debug('Hello');
  });
  
  it("should use console if no object specified", function (done) {
    var logger = fnLogger();
    assert.strictEqual(logger, console);
    done();
  });
  
  
});


