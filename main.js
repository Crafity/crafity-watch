// Copyright 2010-2011 Mikeal Rogers
// 
//    Licensed under the Apache License, Version 2.0 (the "License");
//    you may not use this file except in compliance with the License.
//    You may obtain a copy of the License at
// 
//        http://www.apache.org/licenses/LICENSE-2.0
// 
//    Unless required by applicable law or agreed to in writing, software
//    distributed under the License is distributed on an "AS IS" BASIS,
//    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
//    See the License for the specific language governing permissions and
//    limitations under the License.

var sys = require('util')
	, fs = require('fs')
	, path = require('path')
	, events = require('events')
	;

function walk(dir, options, callback) {
	if (!callback) {
		callback = options;
		options = {}
	}
	if (!callback.files) callback.files = {};
	if (!callback.pending) callback.pending = 0;
	callback.pending += 1;
	fs.stat(dir, function (err, stat) {
		try {
			if (err) return callback(new Error(err));
			if (options.filter && options.filter(dir, stat)) return;
			callback.files[dir] = stat;
			fs.readdir(dir, function (err, files) {
				try {
					if (err) return callback(new Error(err));
					files.forEach(function (f) {
						f = path.join(dir, f);
						callback.pending += 1;
						fs.stat(f, function (err, stat) {
							try {
								if (err) return;
								if (options.filter && options.filter(f, stat)) return;
								if (options.ignoreDotFiles && path.basename(f)[0] === '.') return;
								callback.files[f] = stat;
								if (stat.isDirectory()) walk(f, options, callback);
							} catch (err) {
								//console.log("!!!!!!!", err);
							} finally {
								callback.pending -= 1;
								if (callback.pending === 0) callback(null, callback.files);
							}
						})
					});
				} finally {
					callback.pending -= 1;
					if (callback.pending === 0) callback(null, callback.files);
				}
			});
		} finally {
			callback.pending -= 1;
			if (callback.pending === 0) { callback(null, callback.files); }
		}
	});
}

exports.watchTree = function (root, options, callback) {
	if (!callback) {
		callback = options;
		options = {}
	}
	walk(root, options, function (err, files) {
		if (err) { throw err; }
		var fileWatcher = function (f) {
			//console.log("wf", f, !files[f]);
			if (!files[f]) {
				return;
				throw new Error(f + " is not registered!!");
			}
			if (files[f].watching) { return; }
			files[f].watching = true;
			fs.watchFile(f, options, function (c, p) {
				if (c.nlink !== 0) {
					if (c.isDirectory()) {
						fs.readdir(f, function (err, nfiles) {
							if (err) return;
							nfiles.forEach(function (b) {
								var file = path.join(f, b);
								if (!files[file]) {
									fs.stat(file, function (err, stat) {
										if (err) { return; }
										if (options.ignoreDotFiles && path.basename(file)[0] === '.') return;
										if (options.filter && options.filter(file, stat)) return;
										//console.log("New file", file, options.filter);
										files[file] = stat;
										fileWatcher(file);
										callback(file, stat, null);
									})
								}
							})
						});
					} else {
						if (files[f].mtime.getTime() === c.mtime.getTime()) {
							return;
						} else {
							files[f] = c;
							//console.log("Changed file", f);
							return callback(f, c, p);
						}
					}
				} else {
					// unwatch removed files.
					//console.log("Deleted file", f);
					delete files[f]
					fs.unwatchFile(f);
					return callback(f, c, p);
				}

//				// Check if anything actually changed in stat
//				if (files[f] && c.nlink !== 0 && files[f].mtime.getTime() === c.mtime.getTime()) {
//					return;
//				}
//				files[f] = c;
//				if (!files[f].isDirectory()) {
//					console.log("-f, c, p", f, files[f].mtime.getTime(), c.mtime.getTime(), p);
//					callback(f, c, p);
//				}
//				else {
//					console.log("+f, c, p", f, files[f].mtime.getTime(), c.mtime.getTime(), p);
//					fs.readdir(f, function (err, nfiles) {
//						if (err) return;
//						nfiles.forEach(function (b) {
//							var file = path.join(f, b);
//							if (!files[file]) {
//								fs.stat(file, function (err, stat) {
//									callback(file, stat, null);
//									files[file] = stat;
//									fileWatcher(file);
//								})
//							}
//						})
//					})
			});
//				if (c.nlink === 0) {
//					// unwatch removed files.
//					delete files[f]
//					fs.unwatchFile(f);
//				}
//			})
		}
		fileWatcher(root);
		for (i in files) {
			fileWatcher(i);
		}
		callback(files, null, null);
	});
}

exports.createMonitor = function (root, options, cb) {
	if (!cb) {
		cb = options;
		options = {}
	}
	var monitor = new events.EventEmitter();
	monitor.setMaxListeners(50);
	exports.watchTree(root, options, function (f, curr, prev) {
		monitor.setMaxListeners(50);
		if (typeof f == "object" && prev == null && curr === null) {
			monitor.files = f;
			return cb(monitor);
		}
		if (curr && curr.nlink === 0) {
			//console.log("REMOVED", f);
			return monitor.emit("removed", f, curr);
		} else if (curr && !prev) {
			if (curr.atime.toString() === curr.mtime.toString() &&
				curr.atime.toString() === curr.ctime.toString()) {
				//console.log("CREATED", f, curr);
				return monitor.emit("created", f, curr);
			}
			return;
		} else if (curr && prev) {
			//console.log("CHANGED", f);
			monitor.emit("changed", f, curr, prev);
		} else {
			//console.log("OTHER", f);
		}
	})
}

exports.walk = walk;
