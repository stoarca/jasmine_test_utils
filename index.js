import child_process = 'child_process';
import Jasmine from 'jasmine';
import rp from from 'request-promise';
import rpErrors from 'request-promise/errors';
import _ from 'underscore';

// Overwrite the request-promise class with seomthing that prints errors
// more sanely ihttps://github.com/request/promise-core/blob/master/lib/errors.js
rpErrors.StatusCodeError = function(statusCode, body, options, response) {
    this.name = 'StatusCodeError';
    this.statusCode = statusCode;
    this.message = statusCode + '\n' + body;
    console.log(this.message);
    this.error = body; // legacy attribute
    this.options = options;
    this.response = response;

    if (Error.captureStackTrace) { // required for non-V8 environments
        Error.captureStackTrace(this);
    }
}
rpErrors.StatusCodeError.prototype = Object.create(Error.prototype);
rpErrors.StatusCodeError.prototype.constructor = rpErrors.StatusCodeError;

export var getStackTrace = function() {
  var obj = {};
  Error.captureStackTrace(obj, getStackTrace);
  return obj.stack;
};

export var hashCode = function(str) {
  if (str.length === 0) {
    return 0;
  }
  var hash = 0;
  for (var i = 0, len = str.length; i < len; ++i) {
    var chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash);
};

export var safeRequest = async function() {
  return await rp.apply(null, arguments);
};

export var sleep = function(time) {
  return new Promise(function(resolve) {
    setTimeout(resolve, time);
  });
};

export var SocketFeed = function(socket) {
  var self = this;
  this.socket = socket;
  this.waitingOnEvent = null;
  this.notPredicate = null;
  this.queue = [];

  var oldOnEvent = this.socket.onevent.bind(this.socket);
  this.socket.onevent = function(packet) {
    self.queue.push(packet.data);
    self.flushQueue();
    return oldOnEvent(packet);
  };
};
SocketFeed.prototype.flushQueue = function() {
  var self = this;
  while (self.queue.length && self.waitingOnEvent) {
    self.waitingOnEvent(self.queue.shift());
  }
};
SocketFeed.prototype._nicifyPredicate = function(predicate) {
  if (!_.isString(predicate) && !_.isFunction(predicate)) {
    throw new Error('invalid predicate ' + predicate);
  }
  if (_.isString(predicate)) {
    var findEventName = predicate;
    predicate = function(eventName, data) {
      return eventName === findEventName;
    };
  }
  return predicate;
};
SocketFeed.prototype.flush = function() {
  this.queue.length = 0;
};
SocketFeed.prototype.until = async function(predicate) {
  var self = this;
  predicate = this._nicifyPredicate(predicate);
  return new Promise(function(resolve, reject) {
    self.waitingOnEvent = function(packetData) {
      if (predicate.apply(null, packetData)) {
        self.waitingOnEvent = null;
        self.notPredicate = null;
        resolve(packetData[1]);
      } else if (self.notPredicate && self.notPredicate.apply(null, packetData)) {
        self.waitingOnEvent = null;
        self.notPredicate = null;
        reject(packetData[1]);
      }
    };
    self.flushQueue();
  });
};
SocketFeed.prototype.untilTimeout = async function(timeout) {
  var self = this;
  return new Promise(function(resolve, reject) {
    setTimeout(function() {
      self.flushQueue();
      if (self.queue.length === 0) {
        self.waitingOnEvent = null;
        self.notPredicate = null;
        resolve();
      }
    }, timeout);
    self.waitingOnEvent = function(packetData) {
      if (self.notPredicate && self.notPredicate.apply(null, packetData)) {
        self.waitingOnEvent = null;
        self.notPredicate = null;
        reject(packetData[1]);
      }
    };
    self.flushQueue();
  });
};
SocketFeed.prototype.not = function(predicate) {
  this.notPredicate = this._nicifyPredicate(predicate);
  return this;
};

export var startServer = async function(npmScript, doLog) {
  var srv = child_process.spawn('npm', ['run', '-s', npmScript], {detached: true});
  if (doLog) {
    srv.stdout.on('data', function(data) {
      console.log(data.toString('utf8'));
    });
    srv.stderr.on('data', function(data) {
      console.log(data.toString('utf8'));
    });
  }
  await sleep(5000);
  return async function() {
    try {
      process.kill(-srv.pid);
    } catch (e) {
      console.log(e);
    }
  };
};

export var syncify = function(runAsync) {
  return function(done) {
    runAsync().then(done, done.fail);
  }
};

export default var enhancedJasmineStart = function(dir) {
  var jasmine = new Jasmine();
  jasmine.loadConfig({
    'spec_dir': dir,
    'spec_files': [
      '**/*[sS]pec.js'
    ],
    'helpers': [
      'helpers/**/*.js'
    ],
    'stopSpecOnExpectationFailure': false,
    'random': false
  });

  var ansi = {
    green: '\x1B[32m',
    red: '\x1B[31m',
    yellow: '\x1B[33m',
    none: '\x1B[0m'
  };
  var colored = function(color, str) {
    return ansi[color] + str + ansi.none;
  };
  var oldSpecDone = jasmine.reporter.specDone.bind(jasmine.reporter);
  jasmine.reporter.specDone = function(result) {
    if (result.status === 'failed') {
      console.log('\n');
      for (var i = 0; i < result.failedExpectations.length; ++i) {
        var spec = result.failedExpectations[i];
        console.log(result.fullName);
        console.log(colored('red', spec.message));
        console.log(colored('red', spec.stack));
        console.log('\n');
      }
    }
    return oldSpecDone(result);
  };

  jasmine.execute();
};
