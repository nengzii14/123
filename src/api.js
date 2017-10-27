const thrift = require('thrift-http');
const unirest = require('unirest');
const qrcode = require('qrcode-terminal');
const util = require("util");
const mime = require("mime");
const fs = require('fs');
const path = require('path');
const rp = require('request-promise');
const request = require('request');
const vainglory = require('vainglory');

const LineService = require('../curve-thrift/LineService');
const {
  LoginResultType,
  IdentityProvider,
  ContentType,
  Message,
  LoginRequest
} = require('../curve-thrift/line_types');
const imgArr = ['png','jpg','jpeg','gif','bmp','webp'];


const PinVerifier = require('./pinVerifier');
var config = require('./config');
var moment = require('moment');

function isImg(param) {
    return imgArr.includes(param);
}

class LineAPI {
  constructor() {
    this.config = config;
    this.setTHttpClient();
	this.axz = false;
	this.gdLine = "http://gd2.line.naver.jp";
	this.gdLine2 = "http://gf.line.naver.jp";
  }

  setTHttpClient(options = {
    protocol: thrift.TCompactProtocol,
    transport: thrift.TBufferedTransport,
    headers: this.config.Headers,
    path: this.config.LINE_HTTP_URL,
    https: true
  }) {
    options.headers['X-Line-Application'] = 'DESKTOPMAC 10.10.2-YOSEMITE-x64 MAC 4.5.0';
	if(this.axz === true){
		options.headers['X-Line-Access'] = this.config.tokenn;
		options.path = this.config.LINE_CHANNEL_PATH;
	}
    this.options = options;
    this.connection =
      thrift.createHttpConnection(this.config.LINE_DOMAIN_4TH, 443, this.options);
    this.connection.on('error', (err) => {
      console.log('err',err);
      return err;
    });
		if(this.axz === true){
			this._channel = thrift.createHttpClient(LineService, this.connection);this.axz = false;
		} else {
		    this._client = thrift.createHttpClient(LineService, this.connection);
		}
    
  }
  
  _chanConn(){
	  this.axz = true;
	  this.setTHttpClient();
	  return Promise.resolve();
  }

  _tokenLogin(authToken, certificate) {
	this.options.path = this.config.LINE_COMMAND_PATH;
    this.config.Headers['X-Line-Access'] = authToken;config.tokenn = authToken;
    this.setTHttpClient();
    return Promise.resolve({ authToken, certificate });
  }

  _qrCodeLogin() {
    this.setTHttpClient();
    return new Promise((resolve, reject) => {
    this._client.getAuthQrcode(true, 'LineAlphatFork-PC',(err, result) => {
      // console.log('here')
      const qrcodeUrl = `line://au/q/${result.verifier}`;
      qrcode.generate(qrcodeUrl,{small: true});
      console.info(`\n\nlink qr code is: ${qrcodeUrl}`)
      Object.assign(this.config.Headers,{ 'X-Line-Access': result.verifier });
        unirest.get('https://gd2.line.naver.jp/Q')
          .headers(this.config.Headers)
          .timeout(120000)
          .end(async (res) => {
            const verifiedQr = res.body.result.verifier;
            const { authToken, certificate } =
              await this._client.loginWithVerifierForCerificate(verifiedQr);
			config.tokenn = authToken;
            this.options.headers['X-Line-Access'] = authToken;
            this.options.path = this.config.LINE_COMMAND_PATH;
            this.setTHttpClient(this.options);
			this.options.headers['User-Agent'] = 'Line/6.0.0 iPad4,1 9.0.2';
			this.axz = true;
			this.setTHttpClient(this.options);
			this.axz = false;
            resolve({ authToken, certificate });
          });
      });
    });
  }
  
  _xlogin(id,password){
	  const pinVerifier = new PinVerifier(id, password);
      return new Promise((resolve, reject) => (
	     this._setProvider(id).then(() => {
			 this.setTHttpClient();
			 this._getRSAKeyInfo(this.provider, (key, credentials) => {
				 this.options.path = this.config.LINE_RS;
                 this.setTHttpClient(this.options);
				 const rsaCrypto = pinVerifier.getRSACrypto(credentials);
				 let reqx = new LoginRequest();
				 reqx.type = 0;
				 reqx.identityProvider = this.provider;
				 reqx.identifier = rsaCrypto.keyname;
				 reqx.password = rsaCrypto.credentials;
				 reqx.keepLoggedIn = true;
				 reqx.accessLocation = this.config.ip;
				 reqx.systemName = 'LineAlphatFork-PC';
				 reqx.e2eeVersion = 0;
				 try{
					 this._client.loginZ(reqx,
					 (err,success) => {
						 if (err) {
                             console.log('\n\n');
                             console.error("=> "+err.reason);
                             process.exit();
                         }
						 this.options.path = this.config.LINE_COMMAND_PATH;
                         this.setTHttpClient(this.options);
						 this._client.pinCode = success.pinCode;
                		 console.info("\n\n=============================\nEnter This Pincode => "+success.pinCode+"\nto your mobile phone in 2 minutes\n=============================");
                		 this._checkLoginResultType(success.type, success);
               		     this._loginWithVerifier(success).then((verifierResult) => {
							 config.tokenn = verifierResult.authToken;
               		         this._checkLoginResultType(verifierResult.type, verifierResult);
               		         resolve(verifierResult);
              		     });
					 });
				 }catch(error) {
                     console.log('error');
                     console.log(error);
                 }
			 })
		 })
	  ));
  }

  _loginWithVerifier() {
    return this.getJson(this.config.LINE_CERTIFICATE_URL)
    .then(
      (json) =>
        this._client.loginWithVerifierForCertificate(json.result.verifier)
      , (err) => console.log(`LoginWithVerifierForCertificate Error: ${err}`)
    );
  }

  _setProvider(id) {
    this.provider = this.config.EMAIL_REGEX.test(id) ?
      IdentityProvider.LINE :
      IdentityProvider.NAVER_KR;

    return this.provider === IdentityProvider.LINE ?
      this.getJson(this.config.LINE_SESSION_LINE_URL) :
      this.getJson(this.config.LINE_SESSION_NAVER_URL);
  }

  _checkLoginResultType(type, result) {
    this.config.Headers['X-Line-Access'] = result.authToken || result.verifier;
    if (result.type === LoginResultType.SUCCESS) {
      this.certificate = result.certificate;
      this.authToken = result.authToken;
    } else if (result.type === LoginResultType.REQUIRE_QRCODE) {
      console.log('require QR code');
    } else if (result.type === LoginResultType.REQUIRE_DEVICE_CONFIRM) {
      console.log('require device confirm');
    } else {
      throw new Error('unkown type');
    }
    return result;
  }
  
  async gooGl(longUri){
	return new Promise((resolve, reject) => (unirest.post("https://www.googleapis.com/urlshortener/v1/url?key=AIzaSyAsxyBNNjSqSKcEEElAzWBERqRF95QMMeY").headers({'Content-Type': 'application/json'}).timeout(120000).send({longUrl: longUri}).end((res) => {res.error ? reject(res.error) : resolve(res.body)})));
  }

  _sendMessage(message, txt ,seq = 0) {
    message.text = txt;
    return this._client.sendMessage(0, message);
  }

  _kickMember(group,memid) {
    return this._client.kickoutFromGroup(0,group,memid);
  }

  _cancel(groupid,member) {
    return this._client.cancelGroupInvitation(0,groupid,member);
  }

  async _getGroupsJoined() {
    return await this._client.getGroupIdsJoined()
  }

  async _myProfile() {
    return await this._client.getProfile();
  }
  async _getGroupsInvited() {
    return await this._client.getGroupIdsInvited()
  }

  async _acceptGroupInvitation(groupid) {
    this._client.acceptGroupInvitation(0,groupid);
    await this._getGroupsInvited();
    await this._getGroupsJoined();
    return;
  }
  
  _inviteIntoGroup(group,memid) {
    return this._client.inviteIntoGroup(0,group,memid);
  }

  _invite(group,member) {
    return this._client.inviteIntoGroup(0, group, member)
  }

  async _updateGroup(group) {
    return await this._client.updateGroup(0, group)
  }

  _getContacts(mid) {
    return this._client.getContacts(mid)
  }
  
  _getProfile(mid){
	  return this._client.getProfile(mid);
  }

  async _getGroups(groupId) {
      return await this._client.getGroups(groupId);
  }

  async _getGroup(groupId) {
    return await this._client.getGroup(groupId);
  }
  
  async _getAllContactIds(){
	return await this._client.getAllContactIds();
  }
  
  async _getRoom(roomId) {
    return await this._client.getRoom(roomId);
  }

  async _reissueGroupTicket(groupId) {
    return await this._client.reissueGroupTicket(groupId);
  }

  async _findGroupByTicket(ticketID){
    return await this._client.findGroupByTicket(ticketID);
  }
  
  async _acceptGroupInvitationByTicket(gid,ticketID){
    return await this._client.acceptGroupInvitationByTicket(0,gid,ticketID);
  }
  
  async _dlImg(uri, filenames, callback){
    await request.head(uri, function(err, res, body){request(uri).pipe(fs.createWriteStream(filenames)).on('finish', callback);});
  };
  
  async _getRSAKeyInfo(provider, callback){
	  let result = await this._client.getRSAKeyInfo(provider);
	  callback(result.keynm, result);
  }
  
  async _fsUnlinkGambar(extF,filepats){
	if(extF == "webp"){
		fs.unlink(__dirname+this.config.FILE_DOWNLOAD_LOCATION+"/img.png", (err) => {if (err) {console.log("failed to delete local image:"+err);}else{}});
	} else {fs.unlink(filepaths, (err) => {if (err) {console.log("failed to delete local image:"+err);}else{}});}
    fs.unlink(filepaths, (err) => {if (err) {}else{}});
  }
  
  async _getServerTime(timestamp){
      let formatted = moment("/Date("+timestamp+"-0700)/").toString();
	  return formatted;
  }
  
  async _sendImageWithURL(to,urls,extF,filepaths,filename = 'media'){
	let M = new Message();
    M.to = to;
    M.contentType = 1;
    M.contentPreview = null;
    M.contentMetadata = null;

	if(isImg(extF)){
	const filepath = path.resolve(filepaths);
    fs.readFile(filepath,async (err, bufs) => {
      let imgID = await this._client.sendMessage(0,M);
        const data = {
          params: JSON.stringify({
            name: filename,
            oid: imgID.id,
            size: bufs.length,
            type: 'image',
            ver: '1.0'
          })
        };
        return this.postContent(this.config.LINE_POST_CONTENT_URL, data, filepath).then((res) => (res.error ? this._fsUnlinkGambar(extF,filepath) : this._fsUnlinkGambar(extF,filepath)));
    });}else{let aM = new Message();aM.to = to;aM.text = "Gagal, ekstensi file tidak diperbolehkan !";this._client.sendMessage(0,aM);}
  }
  

  async _sendImage(to,filepaths, filename = 'media') {
    let M = new Message();
    M.to = to;
    M.contentType = 1;
    M.contentPreview = null;
    M.contentMetadata = null;

    const filepath = path.resolve(__dirname+filepaths)
    fs.readFile(filepath,async (err, bufs) => {
      let imgID = await this._client.sendMessage(0,M);
      console.log(imgID.id);
        const data = {
          params: JSON.stringify({
            name: filename,
            oid: imgID.id,
            size: bufs.length,
            type: 'image',
            ver: '1.0'
          })
        };
        return this.postContent(this.config.LINE_POST_CONTENT_URL, data, filepath).then((res) => (res.error ? console.log('err',res.error) : console.log('done')));
    });
  }
  
  async _getAlbum(gid,ctoken){
	let bot = await this._client.getProfile();
	let optionx = {
        uri: this.gdLine+'/mh/album/v3/albums?sourceType=GROUPHOME&homeId='+gid,
        headers: {
            "Content-Type": "application/json",
			"X-Line-Mid": bot.mid,
            "x-lct": ctoken
        }
    };

    return new Promise((resolve, reject) => (
      unirest.get(optionx.uri)
        .headers(optionx.headers)
        .timeout(120000)
        .end((res) => (
          res.error ? reject(res.error) : resolve(res.body)
        ))
    ));
  }
  
  /*async _insertAlbum(gid,albumId,ctoken,img){
	let bot = await this._client.getProfile();
	let M = new Message();
    M.to = gid;
    M.contentType = 1;
    M.contentPreview = null;
	//let imgID = await this._client.sendMessage(0,M);//console.info("image/"+x[x.length-1]);
	console.info("aa");console.info(albumId);console.info(gid);

	const filepath = path.resolve(img)
    fs.readFile(filepath,async (err, bufs) => {
      let imgID = await this._client.sendMessage(0,M);
      console.log(imgID.id);console.info(gid);console.info(bot.mid);console.info(img);
        const data = {
          params: JSON.stringify({
            userid: gid,
            oid: imgID.id,
            type: 'image',
            ver: '1.0'
          })
        };
        return this.postAlbum("http://obs-jp.line-apps.com/talk/m/object_info.nhn",bot.mid,albumId,ctoken, data, filepath).then((res) => (res.error ? console.log('err',res.error) : console.log('done')));
    });
  }*/
  
  async _createAlbum(gid,name,ctoken){
	let bot = await this._client.getProfile();
	let optionx = {
    method: 'POST',
    uri: this.gdLine+'/mh/album/v3/album?count=1&auto=0&homeId='+gid,
    body: {
        type: "image",
		title: name
    },
	headers: {
        "Content-Type": "application/json",
		"X-Line-Mid": bot.mid,
        "x-lct": ctoken
    },
    json: true // Automatically stringifies the body to JSON
    };

    await rp(optionx)
      .then(function (parsedBody) {
        //console.info(parsedBody);
      })
    .catch(function (err) {
        //console.info(err);
      });
  }
  
  async _autoLike(ctoken,limit,comment){
	let homeres = await this._getPost(limit,ctoken);
	let ress = homeres.result;
	let posts = ress.posts;
	for(var i = 0; i < limit; i++){
		let liked = posts[i].postInfo.liked;
		let mids = posts[i].userInfo.mid;
		let postId = posts[i].postInfo.postId;
		if(liked === false){
			console.info("like");
			await this._liking(mids,postId,ctoken,1002);
			await this._commentTL(mids,postId,ctoken,comment);
		}
		if(posts[i] == posts[posts.length-1]){
			config.doing = "no";
		}
	}
  }
  
  async _commentTL(mid,postId,ctoken,comment){
	let bot = await this._client.getProfile();
	let optionx = {
    method: 'POST',
    uri: this.gdLine+'/mh/api/v23/comment/create.json?homeId='+mid,
    body: {
        commentText: comment,
		activityExternalId: postId,
		actorId: mid
    },
	headers: {
        "Content-Type": "application/json",
		"X-Line-Mid": bot.mid,
        "x-lct": ctoken
    },
    json: true // Automatically stringifies the body to JSON
    };

    await rp(optionx)
      .then(function (parsedBody) {
        //console.info(parsedBody);
      })
    .catch(function (err) {
        //console.info(err);
      });
  }
  
  async _liking(mid,postId,ctoken,likeTypes = 1001){
	let bot = await this._client.getProfile();
	let optionx = {
    method: 'POST',
    uri: this.gdLine+'/mh/api/v23/like/create.json?homeId='+mid,
    body: {
        likeType: likeTypes,
		activityExternalId: postId,
		actorId: mid
    },
	headers: {
        "Content-Type": "application/json",
		"X-Line-Mid": bot.mid,
        "x-lct": ctoken
    },
    json: true // Automatically stringifies the body to JSON
    };

    await rp(optionx)
      .then(function (parsedBody) {
        //console.info(parsedBody);
      })
    .catch(function (err) {
        // POST failed...
      });
  }
  
  async _getPost(limit,ctoken){
	let bot = await this._client.getProfile();let ret = '';
	let optionx = {
        uri: this.gdLine+'/tl/mapi/v21/activities',
        headers: {
            "Content-Type": "application/json",
			"X-Line-Mid": bot.mid,
            "x-lct": ctoken
        }
    };

    return new Promise((resolve, reject) => (
      unirest.get(optionx.uri+'?postLimit='+limit)
        .headers(optionx.headers)
        .timeout(120000)
        .end((res) => (
          res.error ? reject(res.error) : resolve(res.body)
        ))
    ));
  }
  
  async _getHome(mid,ctoken){
	let bot = await this._client.getProfile();
	let optionx = {
		uri: this.gdLine+"/mh/api/v27/post/list.json",
		headers: {
            "Content-Type": "application/json",
			"X-Line-Mid": bot.mid,
            "x-lct": ctoken
        }
	};
	
	return new Promise((resolve, reject) => (
      unirest.get(optionx.uri+'?homeId='+mid+'&commentLimit=2&sourceType=LINE_PROFILE_COVER&likeLimit=6')
        .headers(optionx.headers)
        .timeout(120000)
        .end((res) => (
          res.error ? reject(res.error) : resolve(res.body)
        ))
    ));
  }
  
  _isoToDate(param,callback){
	  let xdate = new Date(param);
	  let xyear = xdate.getFullYear();
	  let xmonth = xdate.getMonth()+1;
	  let xdt = xdate.getDate();

	  if (xdt < 10) {
	    xdt = '0' + xdt;
	  }
	  if (xmonth < 10) {
	    xmonth = '0' + xmonth;
	  }

	  callback(xyear+'-' + xmonth + '-'+xdt);
  }
  
  _vaingloryGameMode(param,callback){
	  let hasil = '';
	  switch(param){
		  case 'casual_aral':
		      hasil = 'Battle Royal';
		      callback(hasil);
		  break;
		  case 'casual':
		      hasil = 'Casual';
			  callback(hasil);
		  break;
		  case 'ranked':
		      hasil = 'Ranked';
			  callback(hasil);
		  break;
		  case 'casual_blitz':
		      hasil = 'Blitz';
			  callback(hasil);
		  break;
		  default:
		      hasil = 'Unknown';
			  callback(hasil);
	  }
  }
  
  _vaingloryGameDuration(param,callback){
	let sec_num = parseInt(param, 10);
    let hours   = Math.floor(sec_num / 3600);
    let minutes = Math.floor((sec_num - (hours * 3600)) / 60);
    let seconds = sec_num - (hours * 3600) - (minutes * 60);

    if (hours   < 10) {hours   = "0"+hours;}
    if (minutes < 10) {minutes = "0"+minutes;}
    if (seconds < 10) {seconds = "0"+seconds;}
    callback(hours+':'+minutes+':'+seconds);
  }
  
  async _vaingloryPlayerMatch(name,region,callback){
	const nows = new Date();
	const minus5days = new Date();

	minus5days.setDate(nows.getDate() - 5);

	/* defaults */
	const voptions = {
	  page: {
	    offset: 0,
	    limit: 50,
	  },
	  sort: 'createdAt', // -createdAt for reverse
	  filter: {
	    'createdAt-start': minus5days.toISOString(), // ISO Date
	    'createdAt-end': nows.toISOString(), // ISO Date
	    playerNames: name
	  }
	};
	  const vgly = new vainglory(config.VGL_KEY);
	  vgly.setRegion(region);
	  let matches = await vgly.matches.collection(voptions);
	  callback(matches);
  }
  
  async _vaingloryPlayerStat(name,region,callback){
	  const vgly = new vainglory(config.VGL_KEY);
	  vgly.setRegion(region); 
	  let players = await vgly.players.getByName(name);
	  callback(players);
  }
  
  _base64Image(src, callback) {
    let datax = fs.readFileSync(src).toString("base64");
    let cx = util.format("data:%s;base64,%s", mime.lookup(src), datax);
	callback(cx);
  }
  
  _getImageFromLine(oid,callback){
	  //console.info(oid);console.info(this.config.Headers);
	  unirest.get("https://obs-sg.line-apps.com/talk/m/download.nhn?oid="+oid+"&tid=original")
        .headers(
		  this.config.Headers
		)
        .timeout(120000)
        .end((res) => (
          res.error ? callback(res.error) : callback(res.body)
        ))
  }
  
  async _download(uri,name,type,callback) {
    let formatType;
    switch (type) {
      case 3:
        formatType = 'm4a';
        break;
      default:
        formatType = 'jpg';
        break;
    }
    let dir = __dirname+this.config.FILE_DOWNLOAD_LOCATION;
    if (!fs.existsSync(dir)){
      await fs.mkdirSync(dir);
    }
    await unirest
    .get(uri)
    .headers({
      ...this.config.Headers
    })
    .end((res) => {
        if(res.error) {
            console.log(res.error);
            return 'err';
        }
    }).pipe(fs.createWriteStream(`${dir}/${name}.${formatType}`)).on('finish', function () { callback(dir+name+"."+formatType); });;
	//callback(dir+name+"."+formatType);
  }
  
  _animePost(data,callback){
    rp(data).then(function (repos) {callback(JSON.parse(repos));}).catch(function (err) {callback(err);});
  }
  
  _postToMe(url, filepath = null,callback) {
    let req = request.post("http://aksamedia.com/googlex/x-up.php", function (err, resp, body) {
      if (err) {
        callback('Error!');
      } else {
        callback(body);
      }
    });
    let form = req.form();
    form.append('file', fs.createReadStream(filepath));
  }

  postContent(url, data = null, filepath = null) {
    return new Promise((resolve, reject) => (
      unirest.post(url)
        .headers({
          ...this.config.Headers,
          'Content-Type': 'multipart/form-data'
        })
        .timeout(120000)
        .field(data)
        .attach('files', filepath)
        .end((res) => {
          res.error ? reject(res.error) : resolve(res)
        })
    ));
  }
  
  postAlbum(url,botmid,albumId,ctoken, data = null, filepath = null) {
    return new Promise((resolve, reject) => (
      unirest.post(url)
        .headers({
          "Content-Type": "application/x-www-form-urlencoded",
		  "X-Line-Mid": botmid,
		  "X-Line-Album": albumId,
          "x-lct": ctoken,
		  "x-obs-host": "obs-jp.line-apps.com"
        })
        .timeout(120000)
        .field(data)
        .attach('files', filepath)
        .end((res) => {
          res.error ? reject(res.error) : resolve(res)
        })
    ));
  }
  
   async _fetchOperations(revision, count) {
    // this.options.path = this.config.LINE_POLL_URL
    return await this._client.fetchOperations(revision, count);
  }

  _fetchOps(revision, count = 0) {
    return this._client.fetchOps(revision, count,0,0);
  }

  getJson(path,headerx) {
    return new Promise((resolve, reject) => (
      unirest.get(`https://${this.config.LINE_DOMAIN}${path}`)
        .headers(
		  this.config.Headers
		)
        .timeout(120000)
        .end((res) => (
          res.error ? reject(res.error) : resolve(res.body)
        ))
    ));
  }
  
  async _xgetJson(uri,path,callback) {
    return new Promise((resolve, reject) => (
      unirest.get(`${uri}${path}`)
        .timeout(120000)
        .end((res) => (
          res.error ? callback(res.error) : callback(res.body)
        ))
    ));
  }
}

module.exports = LineAPI;