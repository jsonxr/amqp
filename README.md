# amqp-simple
Simplified amqp usage that supports retries, time outs, exceptions

    var amqp = require('amqp-simple');
    connection = new amqp.Connection({ 
      url: 'amqp://dockerhost',
      logger: function () {}  // ignore all logging
    });
    connection.open(function (err) {
      console.log('opened');
      connection.subscribe({
        routingKey: 'mykey',
        consumer: 'consumer',
        handler: function (msg, callback) {
          console.log('received message: ', msg);
          callback(); // acknowledge this message
          connection.close();
          console.log('disconnect?')
        }
      }, function () {
        connection.publish({
          routingKey: 'mykey',
          body: {
            hello: 'world'
          }
        }, function () {
          console.log('published message.')
        }); 
      });
    });

