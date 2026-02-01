"""
Historical Data Collector for LiquidityHunter
Collect and store 5 years of OHLCV data for 200 stocks
Optimized for M4 Max with parallel processing
"""
import asyncio
import os
import time
from datetime import datetime, timedelta
from typing import List, Dict, Optional
from concurrent.futures import ThreadPoolExecutor

import yfinance as yf
import psycopg2
from psycopg2.extras import execute_batch


class HistoricalDataCollector:
    """
    Collect and store 5 years of historical OHLCV data
    Optimized for M4 Max with parallel processing
    """

    def __init__(self):
        # Database connection
        self.db_url = os.getenv('DATABASE_URL')
        if not self.db_url:
            raise ValueError("DATABASE_URL not set in environment")

        # Collection settings
        self.max_workers = 10   # Parallel downloads
        self.batch_size = 100   # Insert batch size
        self.years = 5          # Years of history

        # Stock lists
        self.kr_stocks = self._get_kr_stocks()
        self.us_stocks = self._get_us_stocks()

    def _get_kr_stocks(self) -> List[str]:
        """Top 100 Korean stocks"""
        # KOSPI top stocks
        kospi = [
            "005930.KS",  # 삼성전자
            "000660.KS",  # SK하이닉스
            "035420.KS",  # NAVER
            "005380.KS",  # 현대차
            "051910.KS",  # LG화학
            "035720.KS",  # 카카오
            "006400.KS",  # 삼성SDI
            "000270.KS",  # 기아
            "068270.KS",  # 셀트리온
            "105560.KS",  # KB금융
            "055550.KS",  # 신한지주
            "028260.KS",  # 삼성물산
            "012330.KS",  # 현대모비스
            "017670.KS",  # SK텔레콤
            "036570.KS",  # 엔씨소프트
            "003550.KS",  # LG
            "032830.KS",  # 삼성생명
            "009150.KS",  # 삼성전기
            "018260.KS",  # 삼성에스디에스
            "096770.KS",  # SK이노베이션
            "034730.KS",  # SK
            "033780.KS",  # KT&G
            "010130.KS",  # 고려아연
            "086790.KS",  # 하나금융지주
            "003490.KS",  # 대한항공
            "011200.KS",  # HMM
            "180640.KS",  # 한진칼
            "047050.KS",  # 포스코인터내셔널
            "010950.KS",  # S-Oil
            "047810.KS",  # 한국항공우주
            "066570.KS",  # LG전자
            "207940.KS",  # 삼성바이오로직스
            "003670.KS",  # 포스코홀딩스
            "015760.KS",  # 한국전력
            "030200.KS",  # KT
            "034220.KS",  # LG디스플레이
            "024110.KS",  # 기업은행
            "316140.KS",  # 우리금융지주
            "009540.KS",  # 한국조선해양
            "010140.KS",  # 삼성중공업
            "329180.KS",  # 현대중공업
            "000810.KS",  # 삼성화재
            "139480.KS",  # 이마트
            "004020.KS",  # 현대제철
            "000720.KS",  # 현대건설
            "005490.KS",  # 포스코퓨처엠
            "352820.KS",  # 하이브
            "373220.KS",  # LG에너지솔루션
            "011070.KS",  # LG이노텍
            "090430.KS",  # 아모레퍼시픽
        ]

        # KOSDAQ top stocks
        kosdaq = [
            "247540.KQ",  # 에코프로비엠
            "293490.KQ",  # 카카오게임즈
            "035900.KQ",  # JYP Ent.
            "086520.KQ",  # 에코프로
            "067160.KQ",  # 아프리카TV
            "091990.KQ",  # 셀트리온헬스케어
            "263750.KQ",  # 펄어비스
            "348370.KQ",  # 알테오젠
            "066970.KQ",  # 엘앤에프
            "145020.KQ",  # 휴젤
            "112040.KQ",  # 위메이드
            "041510.KQ",  # 에스엠
            "357780.KQ",  # 솔브레인
            "196170.KQ",  # 알테오젠
            "131970.KQ",  # 테스나
            "058470.KQ",  # 리노공업
            "039030.KQ",  # 이오테크닉스
            "214150.KQ",  # 클래시스
            "068760.KQ",  # 셀트리온제약
            "095340.KQ",  # ISC
            "036930.KQ",  # 주성엔지니어링
            "222080.KQ",  # 씨아이에스
            "141080.KQ",  # 레고켐바이오
            "383220.KQ",  # F&F
            "028300.KQ",  # HLB
            "029960.KQ",  # 코엔텍
            "086900.KQ",  # 메디톡스
            "253450.KQ",  # 스튜디오드래곤
            "039200.KQ",  # 오스코텍
            "078600.KQ",  # 대주전자재료
            "298380.KQ",  # 에이비엘바이오
            "122870.KQ",  # 와이지엔터테인먼트
            "060310.KQ",  # 3S
            "323990.KQ",  # 박셀바이오
            "059090.KQ",  # 미코
            "240810.KQ",  # 원익IPS
            "108320.KQ",  # LX세미콘
            "035760.KQ",  # CJ ENM
            "025980.KQ",  # 아난티
            "194480.KQ",  # 데브시스터즈
            "096530.KQ",  # 씨젠
            "038500.KQ",  # 삼표시멘트
            "101490.KQ",  # 에스앤에스텍
            "137310.KQ",  # 에스디바이오센서
            "322510.KQ",  # 제이엘케이
            "950140.KQ",  # 잉글우드랩
            "277810.KQ",  # 레인보우로보틱스
            "317530.KQ",  # 캐리소프트
            "365340.KQ",  # 성일하이텍
            "060280.KQ",  # 큐렉소
        ]

        return (kospi + kosdaq)[:100]  # Top 100

    def _get_us_stocks(self) -> List[str]:
        """Top 100 US stocks"""
        stocks = [
            # Mega caps
            "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK-B",
            "V", "UNH", "JNJ", "WMT", "JPM", "MA", "PG", "XOM", "HD", "CVX",
            "MRK", "ABBV", "KO", "PEP", "COST", "AVGO", "TMO", "LLY", "NVO",
            "MCD", "CSCO", "ACN", "BAC", "CRM", "AMD", "NFLX", "ADBE", "VZ",

            # Growth tech
            "PLTR", "COIN", "RBLX", "SNOW", "NET", "DDOG", "CRWD", "ZS",
            "OKTA", "MDB", "SHOP", "SQ", "PYPL", "UBER", "LYFT", "ABNB",
            "DASH", "AFRM", "SOFI", "RIVN",

            # Traditional
            "DIS", "NKE", "INTC", "QCOM", "TXN", "INTU", "ISRG", "AMGN",
            "HON", "UNP", "LOW", "BA", "CAT", "DE", "MMM", "GE", "GM", "F",

            # Finance
            "GS", "MS", "C", "WFC", "AXP", "SPGI", "BLK", "SCHW",

            # Healthcare
            "PFE", "BMY", "GILD", "REGN", "VRTX", "BIIB", "MRNA", "CVS",

            # Energy
            "COP", "SLB", "EOG", "PXD",

            # Additional tech
            "ORCL", "IBM", "NOW", "PANW", "FTNT", "SPLK", "WDAY", "TEAM",
            "ZM", "DOCU", "TWLO", "TTD", "U", "ROKU",
        ]

        return stocks[:100]  # Top 100

    def download_symbol_history(self, symbol: str, market: str) -> Optional[List[Dict]]:
        """
        Download 5 years of daily data for a symbol
        Returns list of OHLCV dicts
        """
        try:
            print(f"  Downloading {symbol}...")

            # Calculate date range
            end_date = datetime.now()
            start_date = end_date - timedelta(days=365 * self.years)

            # Download data
            ticker = yf.Ticker(symbol)
            hist = ticker.history(
                start=start_date.strftime('%Y-%m-%d'),
                end=end_date.strftime('%Y-%m-%d'),
                interval='1d'
            )

            if hist.empty:
                print(f"    ⚠️  {symbol}: No data")
                return None

            # Convert to list of dicts
            clean_symbol = symbol.replace('.KS', '').replace('.KQ', '')

            data = []
            for timestamp, row in hist.iterrows():
                data.append({
                    'timestamp': timestamp.to_pydatetime(),
                    'symbol': clean_symbol,
                    'market': market,
                    'open': float(row['Open']),
                    'high': float(row['High']),
                    'low': float(row['Low']),
                    'close': float(row['Close']),
                    'volume': int(row['Volume'])
                })

            print(f"    ✓ {symbol}: {len(data)} records")
            return data

        except Exception as e:
            print(f"    ❌ {symbol}: {str(e)[:50]}")
            return None

    def store_data_batch(self, data: List[Dict]) -> int:
        """Store batch of OHLCV data in PostgreSQL"""
        if not data:
            return 0

        conn = psycopg2.connect(self.db_url)
        cur = conn.cursor()

        try:
            # Prepare data for batch insert
            records = [
                (
                    d['timestamp'],
                    d['symbol'],
                    d['market'],
                    d['open'],
                    d['high'],
                    d['low'],
                    d['close'],
                    d['volume']
                )
                for d in data
            ]

            # Batch insert with ON CONFLICT DO NOTHING (skip duplicates)
            execute_batch(
                cur,
                """
                INSERT INTO ohlcv_data
                (timestamp, symbol, market, open, high, low, close, volume)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT DO NOTHING
                """,
                records,
                page_size=self.batch_size
            )

            conn.commit()
            return len(records)

        except Exception as e:
            conn.rollback()
            print(f"  Error storing batch: {e}")
            return 0

        finally:
            cur.close()
            conn.close()

    async def collect_all_data(self):
        """
        Main collection function
        Downloads all stocks in parallel and stores to DB
        """

        print("=" * 60)
        print("HISTORICAL DATA COLLECTION")
        print("=" * 60)
        print(f"Korean stocks: {len(self.kr_stocks)}")
        print(f"US stocks: {len(self.us_stocks)}")
        print(f"Years: {self.years}")
        print(f"Workers: {self.max_workers}")
        print("=" * 60)

        start_time = time.time()

        # Collect Korean stocks
        print("\n📊 Collecting Korean stocks...")
        kr_data = await self._collect_market(self.kr_stocks, "KR")

        # Collect US stocks
        print("\n📊 Collecting US stocks...")
        us_data = await self._collect_market(self.us_stocks, "US")

        # Statistics
        elapsed = time.time() - start_time
        total_records = kr_data + us_data

        print("\n" + "=" * 60)
        print("COLLECTION COMPLETE")
        print("=" * 60)
        print(f"Korean records: {kr_data:,}")
        print(f"US records: {us_data:,}")
        print(f"Total records: {total_records:,}")
        print(f"Time elapsed: {elapsed/60:.1f} minutes")
        if elapsed > 0:
            print(f"Records/second: {total_records/elapsed:.1f}")
        print("=" * 60)

        return total_records

    async def _collect_market(self, symbols: List[str], market: str) -> int:
        """Collect data for one market"""

        total_records = 0

        # Process in batches to avoid overwhelming system
        for i in range(0, len(symbols), self.max_workers):
            batch = symbols[i:i + self.max_workers]

            batch_num = i // self.max_workers + 1
            total_batches = (len(symbols) - 1) // self.max_workers + 1
            print(f"\nBatch {batch_num}/{total_batches}")

            # Download batch in parallel
            loop = asyncio.get_event_loop()
            with ThreadPoolExecutor(max_workers=self.max_workers) as executor:
                futures = [
                    loop.run_in_executor(
                        executor,
                        self.download_symbol_history,
                        symbol,
                        market
                    )
                    for symbol in batch
                ]

                results = await asyncio.gather(*futures)

            # Store all data from this batch
            batch_records = 0
            for data in results:
                if data:
                    stored = self.store_data_batch(data)
                    batch_records += stored
                    total_records += stored

            print(f"  Batch stored: {batch_records:,} records")

        return total_records


# CLI entry point
if __name__ == "__main__":
    import dotenv
    dotenv.load_dotenv()

    collector = HistoricalDataCollector()
    asyncio.run(collector.collect_all_data())
