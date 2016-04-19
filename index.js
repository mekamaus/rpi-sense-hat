var fs = require('fs');
var glob = require('glob');
var path = require('path');
var stream = require('streamjs');

var fb = (function () {
  var namefile = function(framebuffer) {
    return path.join(framebuffer, 'name');
  };

  var isSenseHatMatrix = function(dir) {
    try {
      return fs.readFileSync(namefile(dir)).toString().trim() === 'RPi-Sense FB';
    } catch (e) {
      return false;
    }
  };

  var devname = function(path) {
    return '/dev/' + path.split('/').reverse()[0];
  };

  var files = glob.sync('/sys/class/graphics/fb*');

  var frameBufferFile = stream(files)
    .filter(isSenseHatMatrix)
    .findFirst();

  if (!frameBufferFile.isPresent()) {
    console.error(
      'Cannot find a Raspberry Pi Sense HAT matrix LED! Are we running on a Pi?'
    );
    return;
  }

  return devname(frameBufferFile.get());
})();

var rotation = 0;

var pos = function(x, y, r) {
  if (r === 0) {
    return 2 * (y * 8 + x);
  }
  if (r === 90) {
    return 2 * (x * 8 + 7 - y);
  }
  if (r === 180) {
    return 2 * ((7 - y) * 8 + 7 - x);
  }
  return 2 * ((7 - x) * 8 + y);
};

var clear = function(fb) {
  for (var y = 8; --y >= 0;) {
    for (var x = 8; --x >= 0;) {
      setPixel(fb, x, y, [0, 0, 0]);
    }
  }
};

var validateRGB = function(rgb) {
  if (!rgb || typeof rgb !== 'object' || rgb.length !== 3) {
    throw new Error('Invalid color ' + rgb + ' must be in form [R, G, B]');
  }
  rgb.forEach(function(col) {
    if (col < 0 || col > 255) {
      throw new Error('RGB color ' + rgb +
        ' violates [0, 0, 0] <= RGB <= [255, 255, 255]');
    }
  });
};

var validatePixels = function (pixels) {
  var errorMessage = 'Pixels must be an 8x8 array of [R, G, B] values';
  if (!pixels || typeof pixels !== 'object' ||  pixels.length !== 8) {
    throw new Error(errorMessage);
  }
  pixels.forEach(function (row) {
    if (!row || typeof row !== 'object' || row.length !== 8) {
      throw new Error(errorMessage);
    }
    row.forEach(function (rgb) {
      validateRGB(rgb);
    });
  });
};

var setPixels = function(fb, pixels) {
  var pixelFn = null;
  if (typeof pixels === 'function') {
    pixelFn = pixels;
  } else {
    validatePixels(pixels);
  }

  var fd = fs.openSync(fb, 'w');
  var buf = new Buffer(2);
  for (var y = 8; --y >= 0;) {
    for (var x = 8; --x >= 0;) {
      var rgb = pixelFn
        ? pixelFn(x, y)
        : pixels[y][x];
      validateRGB(rgb);
      var n = pack(rgb);
      buf.writeUInt16LE(n, 0);
      fs.writeSync(fd, buf, 0, buf.length, pos(x, y, rotation), function (err, n, _) {});
    }
  }
  fs.closeSync(fd);
};

var getPixels = function (fb) {
  var buf = fs.readFileSync(fb);
  pixels = [];
  for (var y = 8; --y >= 0;) {
    var row = [];
    for (var x = 8; --x >= 0;) {
      var n = buf.readUInt16LE(pos(x, y, rotation));
      var rgb = unpack(n);
      row.push(rgb);
    }
    pixels.push(row);
  }
  return pixels;
};

var unpack = function(n) {
  var r = (n & 0xF800) >> 11;
  var g = (n & 0x7E0) >> 5;
  var b = (n & 0x1F);
  var rc = [r << 3, g << 2, b << 3];
  return rc;
};

var pack = function(rgb) {
  if (rgb.length !== 3)
    throw new Error('length = ' + rgb.length + ' violates length = 3');
  var r = (rgb[0] >> 3) & 0x1F;
  var g = (rgb[1] >> 2) & 0x3F;
  var b = (rgb[2] >> 3) & 0x1F;
  var bits = (r << 11) + (g << 5) + b;
  return bits;
};

var getPixel = function(fb, x, y) {
  if (x < 0 || x > 7) throw new Error('x = ' + x + ' violates 0 <= x <= 7');
  if (y < 0 || y > 7) throw new Error('y = ' + y + ' violates 0 <= y <= 7');

  var buf = fs.readFileSync(fb);
  var n = buf.readUInt16LE(pos(x, y, rotation));
  return unpack(n);
};

var setPixel = function(fb, x, y, rgb) {
  if (x < 0 || x > 7) throw new Error('x = ' + x + ' violates 0 <= x <= 7');
  if (y < 0 || y > 7) throw new Error('y = ' + y + ' violates 0 <= y <= 7');

  validateRGB(rgb);
  var fd = fs.openSync(fb, 'w');
  var buf = new Buffer(2);
  var n = pack(rgb);
  buf.writeUInt16LE(n, 0);
  fs.writeSync(fd, buf, 0, buf.length, pos(x, y, rotation), function(error, written, _) {
    console.log('Wrote ' + written + ' bytes');
  });
  fs.closeSync(fd);
};

var setRotation = function (fb, r) {
  if(r !== 0 && r !== 90 && r !== 180 && r !== 270) {
    throw RangeError('Rotation must be 0, 90, 180 or 270 degrees');
  }
  var pixels = getPixels(fb);
  rotation = r;
  setPixels(fb, pixels);
};

var flipHorizontal = function (fb) {
  var pixels = getPixels(fb);
  var flippedPixels = pixels.map(function (row) {
    var flippedRow = row.slice();
    for (var x = 8; --x >= 0;) {
      flippedRow[7 - x] = row[x];
    }
    return flippedRow;
  });
  setPixels(fb, flippedPixels);
};

var flipVertical = function (fb) {
  var pixels = getPixels(fb);
  var flippedPixels = pixels.map(function (row) {
    return row.slice();
  });
  for (var x = 8; --x >= 0;) {
    for (var y = 8; --y >= 0;) {
      flippedPixels[7 - y][x] = pixels[y][x];
    }
  }
  setPixels(fb, flippedPixels);
};

module.exports = {
  getPixel: function(x, y) {
    return getPixel(fb, x, y);
  },
  setPixel: function(x, y, rgb) {
    setPixel(fb, x, y, rgb);
  },
  getPixels: function () {
    return getPixels(fb);
  },
  setPixels: function(pixels) {
    setPixels(fb, pixels);
  },
  clear: function() {
    clear(fb);
  },
  set rotation(r) {
    setRotation(fb, r);
  },
  get rotation() {
    return rotation;
  }
};
