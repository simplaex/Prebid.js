import {ajax} from 'src/ajax';
import adapter from 'src/AnalyticsAdapter';
import find from 'core-js/library/fn/array/find';
import CONSTANTS from 'src/constants.json';
import adaptermanager from 'src/adaptermanager';
import * as utils from 'src/utils';

const analyticsType = 'endpoint';

let rivrAnalytics = Object.assign(adapter({analyticsType}), {
  track({ eventType, args }) {
    if (!window.rivraddon.analytics.getContext()) {
      return;
    }
    utils.logInfo(`ARGUMENTS FOR TYPE: ============= ${eventType}`, args);
    let handler = null;
    switch (eventType) {
      case CONSTANTS.EVENTS.AUCTION_INIT:
        handler = trackAuctionInit;
        break;
      case CONSTANTS.EVENTS.AUCTION_END:
        handler = trackAuctionEnd;
        break;
      case CONSTANTS.EVENTS.BID_WON:
        handler = trackBidWon;
        break;
      case CONSTANTS.EVENTS.BID_TIMEOUT:
        handler = trackBidTimeout;
        break;
    }
    if (handler) {
      handler(args)
    }
  }
});

function trackAuctionInit(args) {
  window.rivraddon.analytics.trackAuctionInit(args);
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
  window.rivraddon.analytics.trackAuctionEnd(args);
};

function trackBidTimeout(args) {
  return [args];
};

// Using closure in order to reference adUnitCode inside the event handler.
export function handleClickEventWithClosureScope(adUnitCode) {
  return function (event) {
    const clickEventPayload = createNewBasicEvent(adUnitCode);
    let link = event.currentTarget.getElementsByTagName('a')[0];
    if (link) {
      clickEventPayload.clickUrl = link.getAttribute('href');
    }

    utils.logInfo('Sending click events with parameters: ', clickEventPayload);
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

// save the base class function
rivrAnalytics.originEnableAnalytics = rivrAnalytics.enableAnalytics;

// override enableAnalytics so we can get access to the config passed in from the page
rivrAnalytics.enableAnalytics = (config) => {
  window.rivraddon.analytics.enableAnalytics(config, utils, ajax, ExpiringQueue);
  rivrAnalytics.originEnableAnalytics(config);
};

adaptermanager.registerAnalyticsAdapter({
  adapter: rivrAnalytics,
  code: 'rivr'
});

export default rivrAnalytics
