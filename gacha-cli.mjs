import { program } from 'commander';
import * as path from 'path';
import * as fs from 'fs';
import Caver from "caver-js";
// import pinFileToIPFS from './ipfsUpload.mjs';
import awsUpload from './awsUpload.mjs';
const CACHE_PATH = './.cache/info.json';
const CONFIG_PATH = './config.json';
const CONTRACT_PATH = './Contract.json';
const WHITELIST_PATH = './whiteList.json';
const TRANSFER_PATH = './transferList.json';
const WL_CACHE = './src/Constant/whiteList.json';

const contractBuffer = fs.readFileSync(CONTRACT_PATH);
const contractJson = contractBuffer.toString();
const contractData = JSON.parse(contractJson);

let gachaAddress = contractData.gachaAddress;
let gachaABI = contractData.gachaABI;


program.version('0.0.2');

program
.command('upload')
.requiredOption(
  '-n, --network <string>',
  'JSON file with gacha machine settings',
)
// .option(
//   '-i, --ipfs',
//   'Upload image files to pinata ipfs if you need',
// )
.option(
  '-a, --aws',
  'Upload image files and json files to aws s3',
)
.action(async (options) => {   
    console.log(options);
    let rpcURL;
    let ret;
    let contract;
    const configBuffer = fs.readFileSync('./config.json');
    const configJson = configBuffer.toString();
    const configData = JSON.parse(configJson);
    const imageExtension = configData.imageExtension;
    let caver;
    let nftContract;
    
    if(options.network == 'baobab'){
        rpcURL = contractData.baobabRPCURL;
        caver = await new Caver(rpcURL);
        gachaAddress = contractData.gachaAddressBaobab;
        contract = await caver.contract.create(gachaABI, gachaAddress);
    }else if(options.network == 'mainnet'){
        rpcURL = contractData.mainnetRPCURL;
        caver = await new Caver(rpcURL);
        gachaAddress = contractData.gachaAddress;
        contract = await caver.contract.create(gachaABI, gachaAddress);
    }else{
      throw new Error(
        'The Network name is wrong. 네트워크명은 baobab이나 mainnet으로 입력 바랍니다.',
      );
    }
    

    const minterAddress = configData.TreasuryAccount;
    const minterPrivateKey = configData.PrivateKey;
    const tokenName = configData.TokenName;
    const tokenSymbol = configData.TokenSymbol;
    ret = caver.klay.accounts.createWithAccountKey(minterAddress, minterPrivateKey);
    ret = caver.klay.accounts.wallet.add(ret);
    ret = caver.klay.accounts.wallet.getAccount(0);


    
    // Set connection with IPFS Node
    // caver.ipfs.setIPFSNode('ipfs.infura.io', 5001, true);
    const jsondir = fs.readdirSync('./json').map(file => path.join('./json', file));
    const imagedir = fs.readdirSync('./image').map(file => path.join('./image', file));
    
    const imageFiles = imagedir.filter(it => {
        return it.endsWith("." + imageExtension);
      });
      const imageFileCount = imageFiles.length;
  
      const jsonFileCount = jsondir.filter(it => {
        return it.endsWith('.json');
      }).length;
      console.log(jsonFileCount);
      
      if (imageFileCount !== jsonFileCount) {
        throw new Error(
          `number of image files (${imageFileCount}) is different than the number of json files (${jsonFileCount}). 이미지 파일과 json 파일의 숫자가 다릅니다.`,
        );
      }
    const totalCnt = configData.NumberOfNFT;
    console.log("total", totalCnt);
    let cacheData = '';    
    let cacheCnt = 0;
    var items = new Array();
    
    if(!fs.existsSync('./.cache')){
      fs.mkdirSync('./.cache');
      ret = await caver.klay.sendTransaction({
        type: 'SMART_CONTRACT_EXECUTION',
        from: minterAddress,
        to: gachaAddress,
        data: contract.methods.mintNewToken(tokenName, tokenSymbol,totalCnt).encodeABI(),
        gas: '5000000'
      }).then(console.log("New collection is successfully made."));
      nftContract = ret.logs[0].address;
      console.log("NFT contract address is ", ret.logs[0].address);
    }else if(fs.existsSync('./.cache/info.json')){      
      const cacheBuffer = fs.readFileSync(CACHE_PATH);
      const cacheJson = cacheBuffer.toString();
      const dataCache = JSON.parse(cacheJson);
      nftContract = dataCache.NFTContract;
      if(dataCache.gachaMachineId != minterAddress || configData.TokenName != dataCache.tokenName){
        throw new Error(
          'The ./cache/info.json file is not match with minter address. ./cache/info.json 파일을 확인하시고, 필요하지 않다면 해당 파일을 삭제해주세요.',
        );
      }
      items = dataCache.items;
      
      cacheData = {
        "tokenName" : configData.TokenName,
        "gachaMachineId" : minterAddress,
        "items" : items,
        "NFTContract" : nftContract
        }    
      fs.writeFileSync(CACHE_PATH, JSON.stringify(cacheData));

      console.log("Start to upload from " + dataCache.items.length + "...");
      cacheCnt = dataCache.items.length;
    }else{    
      ret = await caver.klay.sendTransaction({
        type: 'SMART_CONTRACT_EXECUTION',
        from: minterAddress,
        to: gachaAddress,
        data: contract.methods.mintNewToken(tokenName, tokenSymbol, totalCnt).encodeABI(),
        gas: '5000000'
      }).then(console.log("New collection is successfully made."));
      nftContract = ret.logs[0].address;
      console.log("NFT contract address is ", ret.logs[0].address);
    }
    for(let i = cacheCnt;i<totalCnt;i++){     
      const metadata = 'json/' + i + '.json';        
      const dataBuffer = fs.readFileSync(metadata);
      const dataJson = dataBuffer.toString();
      const metadataJson = JSON.parse(dataJson);
      console.log("Number : ", i);
      
      // if(options.ipfs){
      //   const image = dirName + '/' + i + '.' + imageExtension;
      //   const cidImage = await pinFileToIPFS(image);
      //   // Add a file to IPFS with file path
      //   const uriImage = "https://ipfs.io/ipfs/" + cidImage;        
      //   metadataJson.image = uriImage;
      //   fs.writeFileSync(metadata.toString(), JSON.stringify(metadataJson));  
      // }else 
      if(options.aws){
        const image = 'image/' + i + '.' + imageExtension;
        const cidImage = await awsUpload(image, imageExtension);
        // Add a file to AWSS3 with file path
        const uriImage = cidImage;        
        metadataJson.image = uriImage;
        fs.writeFileSync(metadata.toString(), JSON.stringify(metadataJson));  
      }
            
      let cidMeta; 
      let uriMeta;          
      let uriLength;
      if(options.aws){            
        cidMeta = await awsUpload(metadata, "json"); 
        uriMeta = cidMeta;         
      }
      // else if(options.ipfs){            
      //   cidMeta = await pinFileToIPFS(metadata); 
      //   uriMeta = "ipfs://" + cidMeta;      
      // }else{
      //   if(configData.pinataApiKey.length > 0){         
      //     cidMeta = await pinFileToIPFS(metadata); 
      //     uriMeta = "ipfs://" + cidMeta;      
      //     uriMetaForUpload = uriMetaForUpload + uriMeta; 
      //   }else if(configData.awsAccessKey.length > 0){
      //     cidMeta = await awsUpload(metadata, "json"); 
      //     uriMeta = cidMeta;         
      //   }
      // }
      items.push({
        "id" : i,
        "link" : uriMeta,
        "name" : metadataJson.name
      });   
      cacheData = {
        "tokenName" : configData.TokenName,
        "gachaMachineId" : minterAddress,
        "items" : items,
        "NFTContract" : nftContract
        }    
        
      fs.writeFileSync(CACHE_PATH, JSON.stringify(cacheData));
    }
    let baseTokenURI = "https://" + configData.awsBucketName + ".s3." + configData.awsRegion + ".amazonaws.com/json/";
    
    const nftContractData = await caver.contract.create(contractData.NFTABI, nftContract);
    ret = await caver.klay.sendTransaction({
      type: 'SMART_CONTRACT_EXECUTION',
      from: minterAddress,
      to: nftContract,
      data: nftContractData.methods.setBaseTokenURI(baseTokenURI).encodeABI(),
      gas: '1000000'
    }).then(console.log("BaseTokenURI setting has successfully done!"));
          
    fs.writeFileSync("./src/Constant/info.json", JSON.stringify(cacheData));
});

program
.command('applyWhiteList')
.action(async () => {  
  let ret;
  let rpcURL = contractData.baobabRPCURL;
  let caver = await new Caver(rpcURL);
  const configBuffer = fs.readFileSync('./config.json');
  const configJson = configBuffer.toString();
  const configData = JSON.parse(configJson);
  caver.ipfs.setIPFSNode('ipfs.infura.io', 5001, true);
  
  const WLHash = await caver.ipfs.add(WHITELIST_PATH);
  console.log(WLHash);
  const WL_json = JSON.parse('{"whiteList" : "https://ipfs.io/ipfs/' + WLHash + '"}');
    
  fs.writeFileSync(WL_CACHE, JSON.stringify(WL_json));      
});

program
.command('mintToken')
.argument(
  '<number>',
  'Number of NFTs you want to mint',
)
.requiredOption(
  '-n, --network <string>',
  'JSON file with gacha machine settings',
)
.action(async (files, options, cmd) => {    
    const mintNum = parseInt(cmd.args[0]);
    console.log(options);
    let rpcURL;
    let ret;
    let contract;
    const configBuffer = fs.readFileSync('./config.json');
    const configJson = configBuffer.toString();
    const configData = JSON.parse(configJson);
    const imageExtension = configData.imageExtension;
    let caver;
    
    if(options.network == 'baobab'){
        rpcURL = contractData.baobabRPCURL;
        caver = await new Caver(rpcURL);
        gachaAddress = contractData.gachaAddressBaobab;
        contract = await caver.contract.create(gachaABI, gachaAddress);
    }else if(options.network == 'mainnet'){
        rpcURL = contractData.mainnetRPCURL;
        caver = await new Caver(rpcURL);
        gachaAddress = contractData.gachaAddress;
        contract = await caver.contract.create(gachaABI, gachaAddress);
    }else{
      throw new Error(
        'The Network name is wrong. 네트워크명은 baobab이나 mainnet으로 입력 바랍니다.',
      );
    }   
    const cacheBuffer = fs.readFileSync(CACHE_PATH);
    const cacheJson = cacheBuffer.toString();
    const dataCache = JSON.parse(cacheJson);
    

    const minterAddress = configData.TreasuryAccount;
    const minterPrivateKey = configData.PrivateKey;
    const tokenName = configData.TokenName;
    const tokenSymbol = configData.TokenSymbol;
    ret = caver.klay.accounts.createWithAccountKey(minterAddress, minterPrivateKey);
    ret = caver.klay.accounts.wallet.add(ret);
    ret = caver.klay.accounts.wallet.getAccount(0);
    let uriMeta = "";
    let gaslimit = 850000 * mintNum;
    let totalCnt = configData.NumberOfNFT;
    let mintCount = await contract.methods.getMintedCount(minterAddress).call();
    if((parseInt(mintCount) + parseInt(mintNum)) > totalCnt){      
      throw new Error(
        'Mint number is more than max count. 최대발행갯수보다 많은 수의 발행을 시도하였습니다.',
      );
    }
    for(let i=mintCount;i<parseInt(mintCount) + parseInt(mintNum);i++){
      uriMeta = uriMeta + dataCache.items[i].link.toString();
    }
    ret = await caver.klay.sendTransaction({
      type: 'SMART_CONTRACT_EXECUTION',
      from: minterAddress,
      to: gachaAddress,
      value: caver.utils.toPeb((0.21 * mintNum).toString(), 'KLAY'),
      data: contract.methods.mint(minterAddress,mintNum, minterAddress).encodeABI(),
      gas: gaslimit
    }).then(async (res)=>{
      console.log("Mint has succeded");
      mintCount = await contract.methods.getMintedCount(minterAddress).call();
      console.log("You've minted " + mintNum + " of NFTs. Totally " + mintCount + " minted.");
    })
    .catch((err) => {
      console.log(err);
      console.log("Mint has failed.");
      console.log("가스비가 모자라거나, 최대발행량을 넘긴 Mint일 수 있습니다.");
    });

});


program
.command('multiTransfer')
.requiredOption(
  '-n, --network <string>',
  'JSON file with gacha machine settings',
)
.action(async (options, cmd) => {    
    console.log(options);
    let rpcURL;
    let ret;
    let contract;
    const configBuffer = fs.readFileSync('./config.json');
    const configJson = configBuffer.toString();
    const configData = JSON.parse(configJson);
    let caver;
    const cacheBuffer = fs.readFileSync(CACHE_PATH);
    const cacheJSON = cacheBuffer.toString();
    const cacheData = JSON.parse(cacheJSON);
    
    if(options.network == 'baobab'){
        rpcURL = contractData.baobabRPCURL;
        caver = await new Caver(rpcURL);
    }else if(options.network == 'mainnet'){
        rpcURL = contractData.mainnetRPCURL;
        caver = await new Caver(rpcURL);
    }else{
      throw new Error(
        'The Network name is wrong. 네트워크명은 baobab이나 mainnet으로 입력 바랍니다.',
      );
    }

    const minterAddress = configData.TreasuryAccount;
    const minterPrivateKey = configData.PrivateKey;
    ret = caver.klay.accounts.createWithAccountKey(minterAddress, minterPrivateKey);
    ret = caver.klay.accounts.wallet.add(ret);
    ret = caver.klay.accounts.wallet.getAccount(0);

    
    const trListBuffer = fs.readFileSync(TRANSFER_PATH);
    const trListJson = trListBuffer.toString();
    const trListData = JSON.parse(trListJson);
    const kip17Instance = await new caver.klay.KIP17(cacheData.NFTContract);
    let startTokenId = trListData.startTokenId;
    for(let i = 0; i<trListData.items.length;i++){
      console.log("address : ", trListData.items[i].address);
      for(let j = 0;j<trListData.items[i].tokenNum;j++){ 
        ret = await kip17Instance.safeTransferFrom(minterAddress, trListData.items[i].address.toString(), startTokenId, {
          from : minterAddress,
          gas: '1000000'
        }).then((res) => {
          console.log("Number " + startTokenId + " has sent.");
          startTokenId++;        
        })
        .catch((err) => {
          console.log(err);
          console.log("Transfer has failed.");
          console.log("가스비가 모자라거나, 소유하지 않은 NFT일 수 있습니다. 이외에 Transfer가 끊긴 경우, 현재까지 진행된 Transfer 리스트를 transferList.json에서 삭제하시고 재실행해보시길 바랍니다.");
        });
      }     
    }      
});

program
.command('updateMaxNumber')
.argument(
  '<number>',
  'Number of NFTs you want to mint',
)
.requiredOption(
  '-n, --network <string>',
  'JSON file with gacha machine settings',
)
.action(async (files,options, cmd) => {  
    const maxCount = parseInt(cmd.args[0]);
    console.log(options);
    let rpcURL;
    let ret;
    let contract;
    const configBuffer = fs.readFileSync('./config.json');
    const configJson = configBuffer.toString();
    const configData = JSON.parse(configJson);
    let caver;
    const cacheBuffer = fs.readFileSync(CACHE_PATH);
    const cacheJSON = cacheBuffer.toString();
    const cacheData = JSON.parse(cacheJSON);
    
    if(options.network == 'baobab'){
      rpcURL = contractData.baobabRPCURL;
      caver = await new Caver(rpcURL);
      gachaAddress = cacheData.NFTContract;
      contract = await caver.contract.create(contractData.NFTABI, gachaAddress);
    }else if(options.network == 'mainnet'){
        rpcURL = contractData.mainnetRPCURL;
        caver = await new Caver(rpcURL);
        gachaAddress = cacheData.NFTContract;
        contract = await caver.contract.create(contractData.NFTABI, gachaAddress);
    }else{
      throw new Error(
        'The Network name is wrong. 네트워크명은 baobab이나 mainnet으로 입력 바랍니다.',
      );
    }   

    const minterAddress = configData.TreasuryAccount;
    const minterPrivateKey = configData.PrivateKey;
    ret = caver.klay.accounts.createWithAccountKey(minterAddress, minterPrivateKey);
    ret = caver.klay.accounts.wallet.add(ret);
    ret = caver.klay.accounts.wallet.getAccount(0);
    ret = await caver.klay.sendTransaction({
      type: 'SMART_CONTRACT_EXECUTION',
      from: minterAddress,
      to: gachaAddress,
      data: contract.methods.updateTokenMaxCnt(maxCount).encodeABI(),
      gas: '1000000'
    }).then(async () =>{
      configData.NumberOfNFT = maxCount;      
      fs.writeFileSync('./config.json', JSON.stringify(configData));   
      console.log("Total mint number is now ", maxCount)
      console.log("최대발행량을 늘리신 다음에는 upload명령어를 통해 메타데이터를 스토리지에 업로드해주세요.");
    })
    .catch((err) => {
      console.log(err);
      console.log("Transaction has failed.");
      console.log("가스비가 모자라지 않은지 확인해주세요.");
    });;

    
});


program
.command('setBaseURI')
.requiredOption(
  '-n, --network <string>',
  'JSON file with gacha machine settings',
)
.action(async (files,options, cmd) => {  
    const maxCount = parseInt(cmd.args[0]);
    console.log(options);
    let rpcURL;
    let ret;
    let contract;
    const configBuffer = fs.readFileSync('./config.json');
    const configJson = configBuffer.toString();
    const configData = JSON.parse(configJson);
    let caver;
    const cacheBuffer = fs.readFileSync(CACHE_PATH);
    const cacheJSON = cacheBuffer.toString();
    const cacheData = JSON.parse(cacheJSON);
    
    if(options.network == 'baobab'){
      rpcURL = contractData.baobabRPCURL;
      caver = await new Caver(rpcURL);
      gachaAddress = cacheData.NFTContract;
      contract = await caver.contract.create(contractData.NFTABI, gachaAddress);
    }else if(options.network == 'mainnet'){
        rpcURL = contractData.mainnetRPCURL;
        caver = await new Caver(rpcURL);
        gachaAddress = cacheData.NFTContract;
        contract = await caver.contract.create(contractData.NFTABI, gachaAddress);
    }else{
      throw new Error(
        'The Network name is wrong. 네트워크명은 baobab이나 mainnet으로 입력 바랍니다.',
      );
    }   

    const minterAddress = configData.TreasuryAccount;
    const minterPrivateKey = configData.PrivateKey;
    ret = caver.klay.accounts.createWithAccountKey(minterAddress, minterPrivateKey);
    ret = caver.klay.accounts.wallet.add(ret);
    ret = caver.klay.accounts.wallet.getAccount(0);
    let baseTokenURI = "https://" + configData.awsBucketName + ".s3." + configData.awsRegion + ".amazonaws.com/json/";
    ret = await caver.klay.sendTransaction({
      type: 'SMART_CONTRACT_EXECUTION',
      from: minterAddress,
      to: gachaAddress,
      data: contract.methods.setBaseTokenURI(baseTokenURI).encodeABI(),
      gas: '1000000'
    }).then(console.log("BaseTokenURI setting has successfully done!"));

    
});


program
.command('nftBurn')
.argument(
  '<number>',
  'Number of NFTs you want to burn',
)
.requiredOption(
  '-n, --network <string>',
  'JSON file with gacha machine settings',
)
.action(async (files,options, cmd) => {  
  const tokenId = parseInt(cmd.args[0]);
    console.log(options);
    let rpcURL;
    let ret;
    let contract;
    const configBuffer = fs.readFileSync('./config.json');
    const configJson = configBuffer.toString();
    const configData = JSON.parse(configJson);
    const cacheBuffer = fs.readFileSync(CACHE_PATH);
    const cacheJson = cacheBuffer.toString();
    const dataCache = JSON.parse(cacheJson);
    const imageExtension = configData.imageExtension;
    let caver;
    
    if(options.network == 'baobab'){
        rpcURL = contractData.baobabRPCURL;
        caver = await new Caver(rpcURL);
        gachaAddress = dataCache.NFTContract;
        gachaABI = contractData.NFTABI;
        contract = await caver.contract.create(gachaABI, gachaAddress);
    }else if(options.network == 'mainnet'){
        rpcURL = contractData.mainnetRPCURL;
        caver = await new Caver(rpcURL);
        gachaAddress = dataCache.NFTContract;
        gachaABI = contractData.NFTABI;
        contract = await caver.contract.create(gachaABI, gachaAddress);
    }else{
      throw new Error(
        'The Network name is wrong. 네트워크명은 baobab이나 mainnet으로 입력 바랍니다.',
      );
    }
    
    const minterAddress = configData.TreasuryAccount;
    const minterPrivateKey = configData.PrivateKey;
    ret = caver.klay.accounts.createWithAccountKey(minterAddress, minterPrivateKey);
    ret = caver.klay.accounts.wallet.add(ret);
    ret = caver.klay.accounts.wallet.getAccount(0);

    
    ret = await caver.klay.sendTransaction({
      type: 'SMART_CONTRACT_EXECUTION',
      from: minterAddress,
      to: gachaAddress,
      data: contract.methods.burnSingle(tokenId).encodeABI(),
      gas: "1000000"
    }).then(async (res)=>{
      console.log("Burn has succeded");
    })
    .catch((err) => {
      console.log(err);
      console.log("Burn has failed.");
      console.log("소각할 NFT의 소유자가 아니거나, 가스비가 모자랍니다.");
    });
    
    
});


program
.command('setRandomMint')
.requiredOption(
  '-n, --network <string>',
  'JSON file with gacha machine settings',
)
.action(async (options) => {  
    console.log(options);
    let rpcURL;
    let ret;
    let contract;
    const configBuffer = fs.readFileSync('./config.json');
    const configJson = configBuffer.toString();
    const configData = JSON.parse(configJson);  
    const cacheBuffer = fs.readFileSync(CACHE_PATH);
    const cacheJson = cacheBuffer.toString();
    const dataCache = JSON.parse(cacheJson);
    let nftContract = dataCache.NFTContract;
    const imageExtension = configData.imageExtension;
    let caver;
    const totalCnt = configData.NumberOfNFT;
    
    if(options.network == 'baobab'){
        rpcURL = contractData.baobabRPCURL;
        caver = await new Caver(rpcURL);
        gachaAddress = nftContract;
        gachaABI = contractData.NFTABI;
        contract = await caver.contract.create(gachaABI, gachaAddress);
    }else if(options.network == 'mainnet'){
        rpcURL = contractData.mainnetRPCURL;
        caver = await new Caver(rpcURL);
        gachaAddress = nftContract;
        gachaABI = contractData.NFTABI;
        contract = await caver.contract.create(gachaABI, gachaAddress);
    }else{
      throw new Error(
        'The Network name is wrong. 네트워크명은 baobab이나 mainnet으로 입력 바랍니다.',
      );
    }
    
    const minterAddress = configData.TreasuryAccount;
    const minterPrivateKey = configData.PrivateKey;
    ret = caver.klay.accounts.createWithAccountKey(minterAddress, minterPrivateKey);
    ret = caver.klay.accounts.wallet.add(ret);
    ret = caver.klay.accounts.wallet.getAccount(0);

    
    const mintOrderBuffer = fs.readFileSync("./mintOrder.json");
    const mintOrderJson = mintOrderBuffer.toString();
    const datamintOrder = JSON.parse(mintOrderJson);
    let mintOrder = new Array();
    let mintOrderForContract = new Array();
    if(datamintOrder.length > 0){
      mintOrder = datamintOrder;
      if(dataCache.items.length < totalCnt){
        throw new Error(
          '최대발행량을 늘리셨다면, 먼저 upload 명령어를 통해 TokenURI를 업로드해주세요. If you modified the maximum NFT number, please upload TokenURI first.',
        );

      }
    }else{
      mintOrder = [];    
    }
    let numberTemp = new Array();
    let orderPreSize = mintOrder.length
    for(let i=orderPreSize;i<totalCnt;i++){
      let flag = 0;
      while(flag == 0){
        let NumberNFT = Math.floor(Math.random() * ((parseInt(totalCnt)-orderPreSize))) + orderPreSize;
        if(numberTemp[NumberNFT] != 1){
          mintOrder.push(NumberNFT);
          mintOrderForContract.push(NumberNFT);
          numberTemp[NumberNFT] = 1;
          flag = 1;
        }
      }
      flag = 0;
    }
    
    let tempMintOrder = new Array();
    let uploadCnt = 0;
    for(let i = orderPreSize;i<mintOrder.length;i++){
      uploadCnt++;
      ret = await tempMintOrder.push(mintOrderForContract[i-orderPreSize]);
      if((i+1)%1000 == 0 || i == (mintOrder.length-1)){
        let gaslimit = uploadCnt *100000;
        ret = await caver.klay.sendTransaction({
          type: 'SMART_CONTRACT_EXECUTION',
          from: minterAddress,
          to: gachaAddress,
          data: contract.methods.setmintOrder(tempMintOrder, (i - uploadCnt +1)).encodeABI(),
          gas: gaslimit
        }).then(async (res)=>{
          console.log("Mint Order has set");
          fs.writeFileSync('./mintOrder.json', JSON.stringify(mintOrder)); 
          tempMintOrder = [];  
          uploadCnt = 0;
        })
        .catch((err) => {
          console.log(err);
          console.log("Mint Order setting has failed");
        });

      }
    }
    
    
});


program
.command('setPurchaseLimit')
.argument(
  '<number>',
  'Number of NFTs you want to set',
)
.requiredOption(
  '-n, --network <string>',
  'JSON file with gacha machine settings',
)
.action(async (files,options, cmd) => {  
  const purchaseLimit = parseInt(cmd.args[0]);
    console.log(options);
    let rpcURL;
    let ret;
    let contract;
    const configBuffer = fs.readFileSync('./config.json');
    const configJson = configBuffer.toString();
    const configData = JSON.parse(configJson);  
    const cacheBuffer = fs.readFileSync(CACHE_PATH);
    const cacheJson = cacheBuffer.toString();
    const dataCache = JSON.parse(cacheJson);
    let nftContract = dataCache.NFTContract;
    const imageExtension = configData.imageExtension;
    let caver;
    const totalCnt = configData.NumberOfNFT;
    
    if(options.network == 'baobab'){
        rpcURL = contractData.baobabRPCURL;
        caver = await new Caver(rpcURL);
        gachaAddress = nftContract;
        gachaABI = contractData.NFTABI;
        contract = await caver.contract.create(gachaABI, gachaAddress);
    }else if(options.network == 'mainnet'){
        rpcURL = contractData.mainnetRPCURL;
        caver = await new Caver(rpcURL);
        gachaAddress = nftContract;
        gachaABI = contractData.NFTABI;
        contract = await caver.contract.create(gachaABI, gachaAddress);
    }else{
      throw new Error(
        'The Network name is wrong. 네트워크명은 baobab이나 mainnet으로 입력 바랍니다.',
      );
    }
    
    const minterAddress = configData.TreasuryAccount;
    const minterPrivateKey = configData.PrivateKey;
    ret = caver.klay.accounts.createWithAccountKey(minterAddress, minterPrivateKey);
    ret = caver.klay.accounts.wallet.add(ret);
    ret = caver.klay.accounts.wallet.getAccount(0);

      ret = await caver.klay.sendTransaction({
        type: 'SMART_CONTRACT_EXECUTION',
        from: minterAddress,
        to: gachaAddress,
        data: contract.methods.updatePurchaseLimit(purchaseLimit).encodeABI(),
        gas: "1000000"
      }).then(async (res)=>{
        console.log("Purchase Limit has set");
      })
      .catch((err) => {
        console.log(err);
        console.log("Purchase Limit setting has failed");
      });
});

async function wait(ms){
    return new Promise((resolve) => {
        setTimeout(() => {
            resolve();
        }, ms);
    });
}

program.parse();