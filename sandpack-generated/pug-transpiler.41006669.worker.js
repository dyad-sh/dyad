!function(e){var t={};function r(n){if(t[n])return t[n].exports;var o=t[n]={i:n,l:!1,exports:{}};return e[n].call(o.exports,o,o.exports,r),o.l=!0,o.exports}r.m=e,r.c=t,r.d=function(e,t,n){r.o(e,t)||Object.defineProperty(e,t,{enumerable:!0,get:n})},r.r=function(e){"undefined"!=typeof Symbol&&Symbol.toStringTag&&Object.defineProperty(e,Symbol.toStringTag,{value:"Module"}),Object.defineProperty(e,"__esModule",{value:!0})},r.t=function(e,t){if(1&t&&(e=r(e)),8&t)return e;if(4&t&&"object"==typeof e&&e&&e.__esModule)return e;var n=Object.create(null);if(r.r(n),Object.defineProperty(n,"default",{enumerable:!0,value:e}),2&t&&"string"!=typeof e)for(var o in e)r.d(n,o,function(t){return e[t]}.bind(null,o));return n},r.n=function(e){var t=e&&e.__esModule?function(){return e.default}:function(){return e};return r.d(t,"a",t),t},r.o=function(e,t){return Object.prototype.hasOwnProperty.call(e,t)},r.p="/",r(r.s="../../node_modules/thread-loader/dist/cjs.js?!../../node_modules/babel-loader/lib/index.js?!./src/sandbox/eval/transpilers/pug/pug-worker.ts")}({"../../node_modules/@babel/runtime/helpers/asyncToGenerator.js":function(e,t){function r(e,t,r,n,o,s,i){try{var a=e[s](i),l=a.value}catch(e){return void r(e)}a.done?t(l):Promise.resolve(l).then(n,o)}e.exports=function(e){return function(){var t=this,n=arguments;return new Promise((function(o,s){var i=e.apply(t,n);function a(e){r(i,o,s,a,l,"next",e)}function l(e){r(i,o,s,a,l,"throw",e)}a(void 0)}))}},e.exports.__esModule=!0,e.exports.default=e.exports},"../../node_modules/@babel/runtime/helpers/defineProperty.js":function(e,t,r){var n=r("../../node_modules/@babel/runtime/helpers/toPropertyKey.js");e.exports=function(e,t,r){return(t=n(t))in e?Object.defineProperty(e,t,{value:r,enumerable:!0,configurable:!0,writable:!0}):e[t]=r,e},e.exports.__esModule=!0,e.exports.default=e.exports},"../../node_modules/@babel/runtime/helpers/toPrimitive.js":function(e,t,r){var n=r("../../node_modules/@babel/runtime/helpers/typeof.js").default;e.exports=function(e,t){if("object"!==n(e)||null===e)return e;var r=e[Symbol.toPrimitive];if(void 0!==r){var o=r.call(e,t||"default");if("object"!==n(o))return o;throw new TypeError("@@toPrimitive must return a primitive value.")}return("string"===t?String:Number)(e)},e.exports.__esModule=!0,e.exports.default=e.exports},"../../node_modules/@babel/runtime/helpers/toPropertyKey.js":function(e,t,r){var n=r("../../node_modules/@babel/runtime/helpers/typeof.js").default,o=r("../../node_modules/@babel/runtime/helpers/toPrimitive.js");e.exports=function(e){var t=o(e,"string");return"symbol"===n(t)?t:String(t)},e.exports.__esModule=!0,e.exports.default=e.exports},"../../node_modules/@babel/runtime/helpers/typeof.js":function(e,t){function r(t){return e.exports=r="function"==typeof Symbol&&"symbol"==typeof Symbol.iterator?function(e){return typeof e}:function(e){return e&&"function"==typeof Symbol&&e.constructor===Symbol&&e!==Symbol.prototype?"symbol":typeof e},e.exports.__esModule=!0,e.exports.default=e.exports,r(t)}e.exports=r,e.exports.__esModule=!0,e.exports.default=e.exports},"../../node_modules/thread-loader/dist/cjs.js?!../../node_modules/babel-loader/lib/index.js?!./src/sandbox/eval/transpilers/pug/pug-worker.ts":function(e,t,r){"use strict";r.r(t);var n=r("../../node_modules/@babel/runtime/helpers/asyncToGenerator.js"),o=r.n(n),s=r("../../node_modules/@babel/runtime/helpers/defineProperty.js"),i=r.n(s);class a extends Error{}self.importScripts("".concat("","/static/js/browserified-pug.0.1.0.min.js"));const l=new class{constructor(e){i()(this,"name",void 0),i()(this,"functions",new Map),i()(this,"pendingCalls",new Map),i()(this,"callId",0),i()(this,"isReady",!1),i()(this,"initializeFS",void 0),i()(this,"queuedMessages",[]),this.name=e,self.addEventListener("message",e=>{this.handleMessage(e.data).catch(console.error)}),self.postMessage({type:"worker_started",codesandbox:!0})}registerFunction(e,t){this.functions.set(e,t)}registerFSInitializer(e){this.initializeFS=e}handleMessage(e){var t=this;return o()((function*(){if("object"==typeof e&&e.codesandbox)if(t.isReady)switch(e.type){case"ping":t.isReady&&(yield t.emitReady());break;case"request":yield t.handleCallRequest(e);break;case"response":yield t.handleCallResponse(e);break;case"initialize-fs":if(!t.initializeFS)throw new Error("initializeFS is undefined for ".concat(t.name));yield t.initializeFS()}else t.queuedMessages.push(e);else e.browserfsMessage||console.warn("Invalid message from main thread to ".concat(t.name),e)}))()}handleCallResponse(e){const t=this.pendingCalls.get(e.idx);t&&(e.isError?t.reject(function(e){const t=new a(e.message);return t.name=e.name,t.columnNumber=e.columnNumber,t.fileName=e.fileName,t.lineNumber=e.lineNumber,t}(e.data)):t.resolve(e.data))}handleCallRequest(e){var t=this;return o()((function*(){try{const r=t.functions.get(e.method);if(!r)throw new Error("Could not find registered child function for call ".concat(t.name,"#").concat(e.method));const n=yield r(e.data);self.postMessage({type:"response",codesandbox:!0,idx:e.idx,data:n})}catch(t){console.error(t),self.postMessage({type:"response",codesandbox:!0,idx:e.idx,isError:!0,data:(r=t,{name:r.name,message:r.message,fileName:r.fileName,lineNumber:r.lineNumber,columnNumber:r.columnNumber})})}var r}))()}callFn(e){let t=e.method,r=e.data;const n=this.callId++,o={type:"request",codesandbox:!0,idx:n,method:t,data:r};return new Promise((e,s)=>{this.pendingCalls.set(n,{method:t,data:r,resolve:e,reject:s}),self.postMessage(o)})}emitReady(){this.isReady=!0,this.queuedMessages.forEach(e=>{console.warn("Run queued message",e),this.handleMessage(e).catch(console.error)}),self.postMessage({type:"ready",codesandbox:!0})}}("pug-worker");function u(){return(u=o()((function*(e){const t=e.code,r=e.path;return{transpiledCode:yield new Promise((e,n)=>{self.pug.render(t,{filename:r},(t,r)=>t?n(t):e(r))})}}))).apply(this,arguments)}l.registerFunction("compile",(function(e){return u.apply(this,arguments)})),l.emitReady()}});
//# sourceMappingURL=pug-transpiler.41006669.worker.js.map