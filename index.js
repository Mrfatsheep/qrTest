const express = require('express');
const cors = require('cors');
const axios = require('axios');
const http = require('http');
const https = require('https');
const cluster = require('cluster');
const os = require('os');
var bodyParser = require('body-parser');
const path = require('path');

const agent = new https.Agent({
    rejectUnauthorized: false
});

const QRID = "0d3f8dc0-97d1-11eb-aa07-190768fa193c";
const APIHeader = "https://35.182.153.251/api/";
const login = {"username": "mguo@aquirefms.com", "password": "Ming1234"};

const rangeLimit = 2.0; //Range for listing, unit (km)
var menuLimit = 4;
const initPort = 8080;
const threadAmount = 1;

var xAuthKeyGlobal;

var menuList = [];
var assetsIDList = [];
var assetsNameList = [];
var assetsDistanceList = [];
var menuJsonList = [];

if(cluster.isMaster) {
    for(i = 0; i < threadAmount; i++) {
        var worker = cluster.fork();
        worker.send(i)
    }
} else if(cluster.isWorker){
    process.on('message', function(portIndex) {
        var app = express();
        app.use('/public', express.static('public'));
        app.use(bodyParser.json());

        app.all('*', (req, res, next) => {
            res.header("Access-Control-Allow-Origin", "*");
            res.setHeader('Access-Control-Allow-Methods', 'GET, POST');  
            res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type, Authorization'); 
            next();
        });

        app.post('/init', function (req, res) {
            let latitude = req.body.latitude;
            let longitude = req.body.longitude;
            init(latitude, longitude);
            console.log("got a login request")
            setTimeout(function(){
                // console.log("menu list", menuList);
                if(menuList != []){
                    res.set('Content-Type', 'application/json');
                    res.send(JSON.stringify((menuList)));
                    menuList = [];
                    assetsIDList = [];
                    assetsNameList = [];
                    assetsDistanceList = [];
                    menuJsonList = [];
                } else {
                    console.log("Get Assets Time out");
                }

            }, 5000);
        })

        async function init(latitude, longitude) {

            const loginUrl = APIHeader + 'auth/login';
            const resLogin = await axios.post(loginUrl, login, { httpsAgent: agent })
            .then(response => {
                xAuthKeyGlobal = "Bearer " + response.data.token;
            }).catch(error => {
                console.log(error);
            });

            const config = {
                headers: {
                    "X-Authorization": xAuthKeyGlobal,
                },
                httpsAgent: agent,
            };

            const findAssetsUrl = APIHeader + "relations/info?fromId=" + QRID + "&fromType=ASSET";
            const resFindAssets = await axios.get(findAssetsUrl, config)
            .then(response => {
                for(i = 0; i < response.data.length; i ++){
                    if(response.data[i]["to"]["entityType"] == "ASSET") {
                        assetsIDList.push(response.data[i]["to"]["id"]);
                    }
                }
            }).catch(error => {
                console.log(error);
            });

            for(i = 0; i < assetsIDList.length; i++) {
                let assetID = assetsIDList[i];
                let assetName = "";
                let latitudeLocal = 0;
                let longitudeLocal = 0;

                const findAssetNameUrl = APIHeader + "asset/" + assetID;
                const resFindAssetName = await axios.get(findAssetNameUrl, config)
                .then(response => {
                    assetName = response.data.name;
                    assetsNameList.push(assetName);
                }).catch(error => {
                    console.log(error);
                });

                const findAssetAttrUrl = APIHeader + "plugins/telemetry/ASSET/" + assetID + "/values/attributes";
                const resFindAssetAttr = await axios.get(findAssetAttrUrl, config)
                .then(response => {
                    console.log(response["data"]);
                    for(j = 0; j < response.data.length; j++) {
                        if (response["data"][j]["key"] == "latitude") {
                            latitudeLocal = response["data"][j]["value"];
                            console.log(latitudeLocal);
                        }
                        if (response["data"][j]["key"] == "longitude") {
                            longitudeLocal = response["data"][j]["value"];
                        }
                    }
                    distance = distanceInKmBetweenEarthCoordinates(latitude, longitude, latitudeLocal, longitudeLocal);
                    assetsDistanceList.push(distance);
                })

                if(i == assetsIDList.length - 1){
                    let menuJsonListTemp = [];
                    for(k = 0; k < assetsIDList.length; k++) {
                        menuJsonListTemp.push({"name": assetsNameList[k], "id": assetsIDList[k], "distance": assetsDistanceList[k]});
                    }

                    menuJsonListTemp.sort(up);

                    // console.log(menuLimit, menuJsonListTemp.length);
                    if(menuLimit > menuJsonListTemp.length) {
                        menuLimit = menuJsonListTemp.length;
                    }
                    for(l = 0; l < menuLimit; l++) {
                        if(menuJsonListTemp[l].distance < rangeLimit){
                            menuJsonList.push(menuJsonListTemp[l]);
                        }
                    }
                    menuList.push({"menu": menuJsonList});
                    console.log(menuList);
                }
            }
        }


        var dataList = [];
        var deviceIDList = [];
        var deviceNameList = [];
        var deviceDescriptionList = [];
        var deviceDataList = [];


        app.post('/pullData', function (req, res) {
            let id = req.body.id;
            pullData(id);
            setTimeout(function(){

                res.set('Content-Type', 'application/json');
                res.send(JSON.stringify(dataList));
                dataList = [];
                deviceIDList = [];
                deviceNameList = [];
                deviceDescriptionList = [];
                deviceDataList = [];

            }, 8000);
        })

        async function pullData(assetID){

            const config = {
                headers: {
                    "X-Authorization": xAuthKeyGlobal,
                },
                httpsAgent: agent,
            };
            const findDevicesUrl = APIHeader + "relations/info?fromId=" + assetID + "&fromType=ASSET";
            const resFindDevices = await axios.get(findDevicesUrl, config)
            .then(response => {
                for(i = 0; i < response.data.length; i ++){
                    if(response.data[i]["to"]["entityType"] == "DEVICE") {
                        deviceIDList.push(response.data[i]["to"]["id"]);
                    }
                }
            }).catch(error => {
                console.log(error);
            });

            for(j = 0; j < deviceIDList.length; j++) {
                const findDeviceNameUrl = APIHeader + "device/" + deviceIDList[j];
                const resFindDeviceName = await axios.get(findDeviceNameUrl, config)
                .then(response => {
                    let deviceName = response.data.name;
                    console.log(deviceName);
                    let deviceDescription = "";
                    try {
                        deviceDescription = response.data.additionalInfo.description;
                    } catch {

                    }
                    deviceNameList.push(deviceName);
                    deviceDescriptionList.push(deviceDescription);
                }).catch(error => {
                    console.log(error);
                });

                var initDay = new Date().setDate(new Date().getDate() - 30);
                initDay = new Date(initDay).setHours(1, 0, 0, 0);
                var endDay = new Date().setDate(new Date().getDate());
                endDay = new Date(endDay).setHours(1, 0, 0, 0);

                const findDeviceDataUrl = APIHeader + "plugins/telemetry/DEVICE/" + deviceIDList[j] + "/values/timeseries?limit=20000&agg=NONE&orderBy=ASC&useStrictDataTypes=false&keys=T1&startTs=" + initDay + "&endTs=" + endDay;
                const resFindDeviceData = await axios.get(findDeviceDataUrl, config)
                .then(response => {
                    deviceDataList.push(response.data);
                }).catch(error => {
                    console.log(error);
                });

                if(j == deviceIDList.length-1){
                    dataList.push({"idList" : deviceIDList, "nameList" : deviceNameList, "descriptionList": deviceDescriptionList, "data": deviceDataList});
                }
            }
        }

        // functions for sorting the array
        function up(x, y) {
            return x.distance - y.distance;
        }

        // functions for calculating the distance between two GPS coordinates
        function degreesToRadians(degrees) {
            return degrees * Math.PI / 180;
        }

        function distanceInKmBetweenEarthCoordinates(lat1, lon1, lat2, lon2) {
            var earthRadiusKm = 6371;
            var dLat = degreesToRadians(lat2-lat1);
            var dLon = degreesToRadians(lon2-lon1);
            lat1 = degreesToRadians(lat1);
            lat2 = degreesToRadians(lat2);
            var a = Math.sin(dLat/2) * Math.sin(dLat/2) + Math.sin(dLon/2) * Math.sin(dLon/2) * Math.cos(lat1) * Math.cos(lat2); 
            var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)); 
            return earthRadiusKm * c;
        }

        var portID = initPort + portIndex;
        var server = app.listen(portID, function () {
          var host = server.address().address;
          var port = server.address().port;
          console.log("Express Server Up. Visiting: localhost:" + portID);
        })
    });
}