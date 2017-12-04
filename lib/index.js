const _ = require('lodash');
const Path = require('path');
const Shell = require('shelljs');
const Express = require('express');
const Webpack = require('webpack');
const BoiMock = require('../../boi-mock');
const BoiUtils = require('boi-utils');
const BoiTranspiler = require('../../boi-transpiler');
const BoiAuxInstall = require('boi-aux-autoinstall');
const WebpackDevMiddleware = require('webpack-dev-middleware');
const WebpackHotMiddleware = require('webpack-hot-middleware');

/**
 * @desc serve index document on the root path
 * @param {Object}   req  http request object
 * @param {Object}   res  http response object
 * @param {Function} next callback
 */
function RedirectMiddleware(viewDir) {
  return function (req, res, next) {
    if (/\.html$/.test(req.url) && viewDir !== '.' && viewDir !== '/') {
      const Reg_ViewDir = new RegExp(`^\/${viewDir}\/.+\.html$`);
      // html文件request映射到其源文件目录
      if (!Reg_ViewDir.test(req.url)) {
        req.url = req.url.replace(/\//, `\/${viewDir}\/`);
      }
    }
    next();
  };
}

/**
 * @constant App Express instance object
 */
const App = new Express();

/**
 * @module boi/compiler
 * @param {Object}  configuration configuration of boi
 * @param {boolean} isInstallDeps whether install dependencies before execution
 */
module.exports = function (configuration, isInstallDeps) {
  const {
    webpackConf: WebpackConf,
    dependencies: Dependencies
  } = BoiTranspiler(configuration, isInstallDeps);

  // webpack compiler
  const WebpackCompiler = Webpack(WebpackConf);

  const OutputPath = WebpackConf.output.path;


  const {
    compile: Conf_Compile,
    serve: Conf_Serve,
    mock: Conf_Mock
  } = configuration;

  // clean output directory before compile
  Shell.rm('-rf', OutputPath);

  // install dependencies before build
  BoiAuxInstall(isInstallDeps, Dependencies).then(() => {
    // enable mock server if mock configuration is not empty
    if (Conf_Mock && !_.isEmpty(Conf_Mock)) {
      BoiMock(App, Conf_Mock);
    }

    const DevMiddleware = WebpackDevMiddleware(WebpackCompiler, Conf_Serve.devServerConfig);
    const HotMiddleware = WebpackHotMiddleware(WebpackCompiler, {
      log: false,
      heartbeat: 2000
    });

    DevMiddleware.waitUntilValid(() => BoiUtils.log.info(`Server is listening ${Conf_Serve.port}\n`));

    // html's modification triggers livereload
    // WebpackCompiler.plugin('compilation', compilation => {
    //   compilation.plugin('html-webpack-plugin-after-emit', (data, cb) => {
    //     HotMiddleware.publish({
    //       action: 'reload'
    //     });
    //     cb();
    //   });
    // });
    /**
     * fix multiple compilation problem when start the dev server
     * @see https://github.com/webpack/watchpack/issues/25#issuecomment-319292564
     */
    const Timefix = 10000;
    
    WebpackCompiler.plugin('watch-run', (watching, callback) => {
      watching.startTime += Timefix;
      callback();
    });

    WebpackCompiler.plugin('done', stats => {
      stats.startTime -= Timefix;
    });

    // temporary css-spirite files
    if (Conf_Compile.style.sprites) {
      App.use(`/${Path.basename(Conf_Compile.basic.output)}`, Express.static(Path.join(process.cwd(), Conf_Compile.basic.output)));
    }

    // serve static thirdparty libraries
    if (_.isArray(Conf_Compile.basic.libs)) {
      Conf_Compile.basic.libs.forEach(lib => {
        App.use(`/${Path.basename(lib)}`, Express.static(Path.join(process.cwd(), lib)));
      });
    }else if(_.isString(Conf_Compile.basic.libs)){
      App.use(`/${Path.basename(Conf_Compile.basic.libs)}`, Express.static(Path.join(process.cwd(), Conf_Compile.basic.libs)));
    }

    App
      .use(RedirectMiddleware(Path.basename(Conf_Compile.html.source)))
      .use(DevMiddleware)
      .use(HotMiddleware);

    App.listen(Conf_Serve.port, err => {
      if (err) {
        throw new Error(err);
      }
    });
  }).catch(err => {
    throw new Error(err);
  });
};