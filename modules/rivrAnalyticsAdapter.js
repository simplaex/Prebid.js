import {ajax} from 'src/ajax';
import adapter from 'src/AnalyticsAdapter';
import find from 'core-js/library/fn/array/find';
import CONSTANTS from 'src/constants.json';
import adaptermanager from 'src/adaptermanager';
import { deepClone, generateUUID, logInfo, timestamp } from 'src/utils';

const analyticsType = 'endpoint';
const rivrUsrIdCookieKey = 'rvr_usr_id';
const DEFAULT_HOST = 'tracker.rivr.simplaex.com';
const DEFAULT_QUEUE_TIMEOUT = 4000;
const ADS_RENDERING_TIMEOUT = 10000;
const RIVR_CONSTANTS = {
  ADSERVER: {
    NONE: 'none',
    DFP: 'DFP',
  }
}

let rivrAnalytics = Object.assign(adapter({analyticsType}), {
  track({ eventType, args }) {
    if (!rivrAnalytics.context) {
      return;
    }
    if (window.rivraddon) {
      window.rivraddon.rivrAnalyticsContext = rivrAnalytics.context;
    }
    logInfo(`ARGUMENTS FOR TYPE: ============= ${eventType}`, args);
    let handler = null;
    switch (eventType) {
      case CONSTANTS.EVENTS.AUCTION_INIT:
        logInfo(`CONSTANTS.EVENTS.AUCTION_INIT rivrAnalytics.context.auctionObject`, rivrAnalytics.context.auctionObject);
        if (rivrAnalytics.context.queue) {
          rivrAnalytics.context.queue.init();
        }
        if (rivrAnalytics.context.auctionObject) {
          rivrAnalytics.context.auctionObject = createNewAuctionObject();
          saveUnoptimisedAdUnits();
          fetchLocalization();
        }
        handler = trackAuctionInit;
        break;
      case CONSTANTS.EVENTS.BID_WON:
        handler = trackBidWon;
        break;
      case CONSTANTS.EVENTS.BID_TIMEOUT:
        handler = trackBidTimeout;
        break;
      case CONSTANTS.EVENTS.AUCTION_END:
        handler = trackAuctionEnd;
        break;
    }
    if (handler) {
      handler(args)
    }
  }
});

export function sendAuction() {
  if (rivrAnalytics.context.authToken) {
    removeEmptyProperties(rivrAnalytics.context.auctionObject);
    let auctionObject = rivrAnalytics.context.auctionObject;
    let req = Object.assign({}, {Auction: auctionObject});
    rivrAnalytics.context.auctionObject = createNewAuctionObject();
    logInfo('sending request to analytics => ', req);
    ajax(
      `http://${rivrAnalytics.context.host}/${rivrAnalytics.context.clientID}/auctions`,
      () => {},
      JSON.stringify(req),
      {
        contentType: 'application/json',
        customHeaders: {
          'Authorization': 'Basic ' + rivrAnalytics.context.authToken
        }
      }
    );
  }
};

export function sendImpressions() {
  if (rivrAnalytics.context.authToken) {
    let impressions = rivrAnalytics.context.queue.popAll();
    if (impressions.length !== 0) {
      let impressionsReq = Object.assign({}, {impressions});
      logInfo('sending impressions request to analytics => ', impressionsReq);
      ajax(
        `http://${rivrAnalytics.context.host}/${rivrAnalytics.context.clientID}/impressions`,
        () => {},
        JSON.stringify(impressionsReq),
        {
          contentType: 'application/json',
          customHeaders: {
            'Authorization': 'Basic ' + rivrAnalytics.context.authToken
          }
        }
      );
    }
  }
};

function trackAuctionInit(args) {
  rivrAnalytics.context.auctionTimeStart = Date.now();
  rivrAnalytics.context.auctionObject.id = args.auctionId;
};

function trackBidWon(args) {
  setWinningBidStatus(args);
};

function setWinningBidStatus(event) {
  let auctionObject = rivrAnalytics.context.auctionObject;
  const bidderObjectForThisWonBid = find(auctionObject.bidders, (bidder) => {
    return bidder.id === event.bidderCode;
  });
  if (bidderObjectForThisWonBid) {
    const bidObjectForThisWonBid = find(bidderObjectForThisWonBid.bids, (bid) => {
      return bid.impId === event.adUnitCode;
    });
    if (bidObjectForThisWonBid) {
      bidObjectForThisWonBid.clearPrice = event.cpm;
      bidObjectForThisWonBid.status = 1;
    }
  }
};

export function trackAuctionEnd(args) {
  rivrAnalytics.context.auctionTimeEnd = Date.now();
  rivrAnalytics.context.auctionObject.bidders = buildBiddersArrayFromAuctionEnd(args);
  rivrAnalytics.context.auctionObject.impressions = buildImpressionsArrayFromAuctionEnd(args);
};

function buildImpressionsArrayFromAuctionEnd(auctionEndEvent) {
  return auctionEndEvent.adUnits.map((adUnit) => {
    const impression = {};
    impression.id = adUnit.code;
    impression.adType = 'unknown';
    impression.acceptedSizes = [];
    const bidReceivedForThisAdUnit = find(auctionEndEvent.bidsReceived, (bidReceived) => {
      return adUnit.code === bidReceived.adUnitCode;
    });
    if (adUnit.mediaTypes) {
      if (adUnit.mediaTypes.banner) {
        buildAdTypeDependentFieldsForImpression(impression, 'banner', adUnit, bidReceivedForThisAdUnit);
      } else if (adUnit.mediaTypes.video) {
        buildAdTypeDependentFieldsForImpression(impression, 'video', adUnit, bidReceivedForThisAdUnit);
      }
    }
    return impression;
  });
}

function buildAdTypeDependentFieldsForImpression(impression, adType, adUnit, bidReceivedForThisAdUnit) {
  impression.adType = adType;
  impression.acceptedSizes = adUnit.mediaTypes[adType].sizes.map((acceptedSize) => {
    return {
      w: acceptedSize[0],
      h: acceptedSize[1]
    };
  });
  if (bidReceivedForThisAdUnit) {
    impression[adType] = {
      w: bidReceivedForThisAdUnit.width,
      h: bidReceivedForThisAdUnit.height
    };
  }
}

function buildBiddersArrayFromAuctionEnd(auctionEndEvent) {
  return auctionEndEvent.bidderRequests.map((bidderRequest) => {
    const bidder = {};
    bidder.id = bidderRequest.bidderCode;
    bidder.bids = bidderRequest.bids.map((bid) => {
      const bidReceivedForThisRequest = find(auctionEndEvent.bidsReceived, (bidReceived) => {
        return bidderRequest.bidderCode === bidReceived.bidderCode &&
          bid.bidId === bidReceived.adId &&
          bid.adUnitCode === bidReceived.adUnitCode;
      });
      return {
        adomain: [''],
        clearPrice: 0.0,
        impId: bid.adUnitCode,
        creativeId: bidReceivedForThisRequest ? bidReceivedForThisRequest.creativeId : '',
        price: bidReceivedForThisRequest ? bidReceivedForThisRequest.cpm : 0.0,
        status: 0
      };
    });
    return bidder;
  });
}

function trackBidTimeout(args) {
  return [args];
};

export function fetchLocalization() {
  if (navigator.permissions) {
    navigator.permissions.query({ name: 'geolocation' }).then((permission) => {
      if (permission.status === 'granted') {
        navigator.geolocation.getCurrentPosition((position) => {
          setAuctionAbjectPosition(position);
        });
      }
    });
  }
}

export function setAuctionAbjectPosition(position) {
  rivrAnalytics.context.auctionObject.device.geo.lat = position.coords.latitude;
  rivrAnalytics.context.auctionObject.device.geo.long = position.coords.longitude;
}

function getPlatformType() {
  if (navigator.userAgent.match(/mobile/i) || navigator.userAgent.match(/iPad|Android|Touch/i)) {
    return 1;
  } else {
    return 2;
  }
};

// Using closure in order to reference adUnitCode inside the event handler.
export function handleClickEventWithClosureScope(adUnitCode) {
  return function (event) {
    const clickEventPayload = createNewBasicEvent(adUnitCode);
    let link = event.currentTarget.getElementsByTagName('a')[0];
    if (link) {
      clickEventPayload.clickUrl = link.getAttribute('href');
    }

    logInfo('Sending click events with parameters: ', clickEventPayload);
    ajax(
      `http://${rivrAnalytics.context.host}/${rivrAnalytics.context.clientID}/clicks`,
      () => {},
      JSON.stringify(clickEventPayload),
      {
        contentType: 'application/json',
        customHeaders: {
          'Authorization': 'Basic ' + rivrAnalytics.context.authToken
        }
      }
    );
  };
}

function createNewBasicEvent(adUnitCode) {
  return {
    timestamp: new Date().toISOString(),
    auctionId: rivrAnalytics.context.auctionObject.id,
    adUnitCode
  }
}

export function handleImpression(adUnitCode) {
  if (rivrAnalytics.context.queue) {
    rivrAnalytics.context.queue.push(createNewBasicEvent(adUnitCode));
  }
}

export function activelyWaitForBannersToRender(adUnitCodesOfNotYetRenderedBanners) {
  let keepCheckingForAdsRendering = true;
  let adUnitCodesOfRenderedBanners = [];
  setTimeout(() => keepCheckingForAdsRendering = false, ADS_RENDERING_TIMEOUT);

  function goThroughNotYetRenderedAds() {
    if (adUnitCodesOfNotYetRenderedBanners.length) {
      adUnitCodesOfNotYetRenderedBanners.forEach((bannerAdUnitCode) => {
        switch (rivrAnalytics.context.adServer) {
          case RIVR_CONSTANTS.ADSERVER.NONE:
            searchForSimpleBanners(bannerAdUnitCode, adUnitCodesOfRenderedBanners);
            break;
          case RIVR_CONSTANTS.ADSERVER.DFP:
            seaschForDFPBanners(bannerAdUnitCode, adUnitCodesOfRenderedBanners);
            break;
        }
      });

      if (keepCheckingForAdsRendering && arrayDifference(adUnitCodesOfNotYetRenderedBanners, adUnitCodesOfRenderedBanners).length) {
        window.requestAnimationFrame(goThroughNotYetRenderedAds);
      }
    }
  }

  goThroughNotYetRenderedAds();
};

function seaschForDFPBanners(bannerAdUnitCode, adUnitCodesOfRenderedBanners) {
  const foundIframe = document.querySelector(`iframe[id*="${bannerAdUnitCode}"]`);
  if (foundIframe && foundIframe.contentDocument) {
    const foundImg = foundIframe.contentDocument.querySelector('a img');
    if (foundImg) {
      handleImpression(bannerAdUnitCode);
      foundIframe.contentDocument.addEventListener('click', handleClickEventWithClosureScope(bannerAdUnitCode));
      adUnitCodesOfRenderedBanners.push(bannerAdUnitCode);
    }
  }
}

function searchForSimpleBanners(bannerAdUnitCode, adUnitCodesOfRenderedBanners) {
  const foundImg = document.querySelector(`[id*="${bannerAdUnitCode}"] a img`);
  if (foundImg && foundImg.height > 1 && foundImg.width > 1) {
    handleImpression(bannerAdUnitCode);
    foundImg.addEventListener('click', handleClickEventWithClosureScope(bannerAdUnitCode));
    adUnitCodesOfRenderedBanners.push(bannerAdUnitCode);
  }
}

export function arrayDifference(array1, array2) {
  return array1.filter((adUnitCode) => {
    return array2.indexOf(adUnitCode) < 0;
  });
}

export function createNewAuctionObject() {
  const auction = {
    id: '',
    publisher: rivrAnalytics.context.clientID,
    timestamp: timestamp(),
    user: {
      id: rivrAnalytics.context.userId
    },
    site: {
      domain: window.location.host,
      page: window.location.pathname,
      categories: rivrAnalytics.context.siteCategories
    },
    impressions: [],
    bidders: [],
    device: {
      userAgent: navigator.userAgent,
      deviceType: getPlatformType()
    },
    'ext.rivr.originalvalues': [],
    'ext.rivr.optimiser': localStorage.getItem('rivr_should_optimise') || 'unoptimised',
    modelVersion: localStorage.getItem('rivr_model_version') || null,
  }

  return auction;
};

export function saveUnoptimisedAdUnits() {
  let units = rivrAnalytics.context.adUnits;
  if (units) {
    if (units.length > 0) {
      let allUnits = concatAllUnits(units);
      allUnits.forEach((adUnit) => {
        adUnit.bids.forEach((bid) => {
          let configForBidder = fetchConfigForBidder(bid.bidder);
          if (configForBidder) {
            let unOptimisedParamsField = createUnOptimisedParamsField(bid, configForBidder);
            rivrAnalytics.context.auctionObject['ext.rivr.originalvalues'].push(unOptimisedParamsField);
          }
        })
      });
    }
  }
};

export function concatAllUnits(units) {
  return Array.prototype.concat.apply([], units);
}

export function createUnOptimisedParamsField(bid, config) {
  let floorPriceLabel = config['floorPriceLabel'];
  let currencyLabel = config['currencyLabel'];
  let pmpLabel = config['pmpLabel'];
  return {
    'ext.rivr.demand_source_original': bid.bidder,
    'ext.rivr.bidfloor_original': bid.params[floorPriceLabel],
    'ext.rivr.currency_original': bid.params[currencyLabel],
    'ext.rivr.pmp_original': bid.params[pmpLabel],
  }
}

function fetchConfigForBidder(bidderName) {
  let config = localStorage.getItem('rivr_config_string');
  if (config) {
    let parsed = JSON.parse(config);
    return parsed.demand.map((bidderConfig) => {
      if (bidderName === bidderConfig.partner) {
        return bidderConfig
      };
    })[0];
  }
}
/**
 * Expiring queue implementation. Fires callback on elapsed timeout since last last update or creation.
 * @param callback
 * @param ttl
 * @constructor
 */
export function ExpiringQueue(sendImpressions, sendAuction, ttl, log) {
  let queue = [];
  let timeoutId;

  this.push = (event) => {
    if (event instanceof Array) {
      queue.push.apply(queue, event);
    } else {
      queue.push(event);
    }
    reset();
  };

  this.popAll = () => {
    let result = queue;
    queue = [];
    reset();
    return result;
  };
  /**
   * For test/debug purposes only
   * @return {Array}
   */
  this.peekAll = () => {
    return queue;
  };

  this.init = reset;

  function reset() {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    timeoutId = setTimeout(() => {
      sendAuction();
      if (queue.length) {
        sendImpressions();
      }
    }, ttl);
  }
};

function removeEmptyProperties(obj) {
  Object.keys(obj).forEach(function(key) {
    if (obj[key] && typeof obj[key] === 'object') removeEmptyProperties(obj[key])
    else if (obj[key] == null) delete obj[key]
  });
};

export function getCookie(name) {
  var value = '; ' + document.cookie;
  var parts = value.split('; ' + name + '=');
  if (parts.length == 2) return parts.pop().split(';').shift();
}

export function storeAndReturnRivrUsrIdCookie() {
  const userId = generateUUID();
  document.cookie = 'rvr_usr_id=' + userId;
  return userId;
}

// save the base class function
rivrAnalytics.originEnableAnalytics = rivrAnalytics.enableAnalytics;

// override enableAnalytics so we can get access to the config passed in from the page
rivrAnalytics.enableAnalytics = (config) => {
  let copiedUnits;
  if (config.options.adUnits) {
    let stringifiedAdUnits = JSON.stringify(config.options.adUnits);
    copiedUnits = JSON.parse(stringifiedAdUnits);
  }
  rivrAnalytics.context = {
    userId: getCookie(rivrUsrIdCookieKey) || storeAndReturnRivrUsrIdCookie(),
    host: config.options.host || DEFAULT_HOST,
    auctionObject: {},
    adUnits: copiedUnits,
    siteCategories: config.options.siteCategories || [],
    clientID: config.options.clientID,
    authToken: config.options.authToken,
    adServer: config.options.adServer,
    queue: new ExpiringQueue(sendImpressions, sendAuction, config.options.queueTimeout || DEFAULT_QUEUE_TIMEOUT)
  };

  let bannersIds = config.options.bannersIds;
  if (bannersIds) {
    if (bannersIds.length > 0) {
      activelyWaitForBannersToRender(deepClone(config.options.bannersIds));
    }
  }
  logInfo('Rivr Analytics enabled with config', rivrAnalytics.context);
  rivrAnalytics.originEnableAnalytics(config);
};

adaptermanager.registerAnalyticsAdapter({
  adapter: rivrAnalytics,
  code: 'rivr'
});

export default rivrAnalytics
