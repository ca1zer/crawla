import sqlite3
import pandas as pd
import networkx as nx
import numpy as np
from tqdm import tqdm
import matplotlib.pyplot as plt
import seaborn as sns
from pathlib import Path
import pickle
from datetime import datetime
from scipy.sparse import csr_matrix

def load_graph_data(db_path, rebuild=False):
    """Load data from SQLite database and create a directed graph."""
    cache_path = Path(str(db_path).replace('.db', '_graph.pickle'))
    
    if not rebuild and cache_path.exists():
        print("Loading graph from cache...")
        with open(cache_path, 'rb') as f:
            G = pickle.load(f)
        print("Graph loaded from cache successfully")
        return G
    
    print("Building graph from database...")
    conn = sqlite3.connect(db_path)
    
    # Load all data into pandas first
    users_df = pd.read_sql_query("""
        SELECT user_id, username, follower_count, following_count, is_verified
        FROM users
    """, conn)
    
    relationships_df = pd.read_sql_query("""
        SELECT user_id, following_id 
        FROM following_relationships
    """, conn)
    
    conn.close()
    
    # First create graph from relationships
    G = nx.from_pandas_edgelist(relationships_df, 'user_id', 'following_id', create_using=nx.DiGraph())
    
    # Set default attributes for all nodes
    default_attrs = {
        'username': 'unknown',
        'follower_count': 1,
        'following_count': 1,
        'is_verified': 0
    }
    nx.set_node_attributes(G, default_attrs)
    
    # Create a dictionary of user attributes
    user_attrs = users_df.set_index('user_id').to_dict('index')
    
    # Update only existing nodes with actual data
    nx.set_node_attributes(G, user_attrs)
    
    print(f"Graph created with {G.number_of_nodes()} nodes and {G.number_of_edges()} edges")
    print(f"Users with data: {len(users_df)}")
    
    with open(cache_path, 'wb') as f:
        pickle.dump(G, f)
    
    return G

def calculate_personalized_pagerank(G, alpha=0.15, max_iter=1000, tol=1e-6, seed_nodes=None):
    """Calculate PageRank scores using sparse matrix operations."""
    print("Preparing matrices...")
    
    # Get adjacency matrix in sparse format
    A = nx.adjacency_matrix(G)
    n = A.shape[0]
    
    # Create node mapping
    node_list = list(G.nodes())
    node_idx = {node: i for i, node in enumerate(node_list)}
    
    # Normalize adjacency matrix by out-degree
    out_degrees = np.array(A.sum(axis=1)).flatten()
    out_degrees[out_degrees == 0] = 1  # Avoid division by zero
    D_inv = csr_matrix((1 / out_degrees, (range(n), range(n))))
    M = A.T.dot(D_inv)
    
    # Initialize personalization vector
    p = np.ones(n) / n
    if seed_nodes:
        seed_indices = [node_idx[node] for node in seed_nodes if node in node_idx]
        p = np.zeros(n)
        p[seed_indices] = 5 / len(seed_indices)  # Much higher weight for seed nodes
    
    # Adjust personalization with follower/following ratio
    for i, node in enumerate(node_list):
        data = G.nodes[node]
        if not (seed_nodes and node in seed_nodes):
            followers = data.get('follower_count', 1)
            following = data.get('following_count', 1)
            p[i] = min(max(0, np.log((followers + 250) / (following + 250))),5)
    
        if following > 8000:
            penalty_factor = min(following / 4000, 10)  # Cap penalty at 3x
            p[i] /= penalty_factor

    # p = p / p.sum()  # Normalize
    p = (p - p.min()) / (p.max() - p.min())  # Scale to [0,1] range    

    # Power iteration
    scores = np.ones(n) / n
    for iteration in tqdm(range(max_iter)):
        prev_scores = scores.copy()
        scores =  (1 - alpha) * M.dot(scores)  + alpha * p 
        
        # Check convergence
        err = np.abs(scores - prev_scores).sum()
        if err < tol:
            print(f"Converged after {iteration + 1} iterations")
            break

    scores -= alpha * p * 1.0 # subtract the boost from followers
    
    # Convert back to dictionary
    score_dict = {node: float(score) for node, score in zip(node_list, scores)}
    
    # Save to graph
    nx.set_node_attributes(G, score_dict, 'pagerank_score')
    G.graph['pagerank_params'] = {
        'alpha': alpha,
        'max_iter': max_iter,
        'tol': tol,
        'num_seed_nodes': len(seed_nodes) if seed_nodes else 0,
        'timestamp': datetime.now().isoformat(),
        'num_nodes': n,
        'num_edges': G.number_of_edges()
    }
    
    checkpoint_path = Path('graph_with_pagerank.pickle')
    print(f"Saving checkpoint to {checkpoint_path}")
    with open(checkpoint_path, 'wb') as f:
        pickle.dump(G, f)
    
    return score_dict

def analyze_results(G, scores, top_n=100):
    """Analyze results with error handling."""
    results = []
    for node, score in scores.items():
        data = G.nodes[node]
        results.append({
            'user_id': node,
            'username': data.get('username', 'unknown'),
            'score': score,
            'follower_count': data.get('follower_count', 0),
            'following_count': data.get('following_count', 0),
        })
    
    results_df = pd.DataFrame(results)
    results_df = results_df.sort_values('score', ascending=False)
    
    top_results = results_df.head(top_n)
    top_results.to_csv('top_influential_accounts.csv', index=False)
    
    return results_df

def main():
    DB_PATH = Path("../data/twitter.db")
    SEED_NODES = [
    "951329744804392960", # solana
    "44196397", # elonmusk
    "1476422418176659457", # Web3Alerts
    "1476395269705154560", # Web3AlertsTrack
    "902926941413453824", # cz_binance
    "877807935493033984", # binance
    "973261472", # blknoiz06
    "1830340867737178112", # shawmakesmagic
    "2312333412", # ethereum
    "295218901", # VitalikButerin
    "2327407569", # aeyakovenko
    "1851849397979480064", # ai16zdao
    "1441835930889818113", # frankdegods
    "574032254", # coinbase
    "1052454006537314306", # BNBCHAIN
    "3012852462", # zachxbt
    "1395504028910424065", # LayerZero_Core
    "2260491445", # CoinMarketCap
    "1628067904083181570", # base
    "1387497871751196672", # WatcherGuru
    "357312062", # Bitcoin
    "1325739682752204800", # traderpow
    "1395261244769112065", # _RichardTeng
    "844304603336232960", # MustStopMurad
    "999947328621395968", # Bybit_Official
    "1852674305517342720", # aixbt_agent
    "1802642686710837249", # truth_terminal
    "14379660", # brian_armstrong
    "1379053041995890695", # phantom
    "1426732252768182281", # notthreadguy
    "2259434528", # cobie
    "1622243071806128131", # pumpdotfun
    "1651199844365766656", # sendaifun
    "2733200058", # deepseekcto
    "2902349190", # TheRoaringKitty
    "1163550920485015558", # ethdotorg
    "101833150", # rajgokal
    "944686196331966464", # HsakaTrades
    "867617849208037377", # okx
    "2412652615", # coingecko
    "1446489618208067586", # JupiterExchange
    "1432635656161746947", # boldleonidas
    "983993370048630785", # CryptoHayes
    "1309886201944473600", # 0xMert_
    "18876842", # jessepollak
    "5943622", # pmarca
    "1762471547485184000", # cookiedotfun
    "1003840309166366721", # heyibinance
    "1424905944857722887", # SOLBigBrain
    "1333467482", # CoinDesk
    "1449140157903482882", # BRICSinfo
    "1851730950566350850", # griffaindotcom
    "1051852534518824960", # inversebrah
    "2361601055", # tier10k
    "588569122", # wallstreetbets
    "1542947918709080065", # eigenlayer
    "946213559213555712", # opensea
    "1614020914563407872", # term_labs
    "1433121559057559555", # MagicEden
    "914738730740715521", # 0xPolygon
    "2207129125", # Cointelegraph
    "1714580962569588736", # deepseek_ai
    "1852499847133143040", # remarks
    "79714172", # zhusu
    "1282727055604486148", # News_Of_Alpha
    "333357345", # Cobratate
    "1738717256169783296", # ponkesol
    "1202781705683255296", # khouuba
    "1138993163706753029", # Pentosh1
    "911011433147654144", # TrustWallet
    "1407290555344769030", # Cookie3_com
    "1866789219613421568", # agentcookiefun
    "1358454920299433985", # RaydiumProtocol
    "912539725071777792", # gate_io
    "1305349277422477313", # PancakeSwap
    "1470958472409792515", # a1lon9
    "1446541960181858315", # based16z
    "1138033434", # Rewkang
    "978566222282444800", # MEXC_Official
    "1044836083530452992", # Optimism
    "1319287761048723458", # MarioNawfal
    "244647486", # saylor
    "1289071298556170240", # GiganticRebirth
    "20006785", # AndyAyrey
    "1332033418088099843", # arbitrum
    "902839045356744704", # justinsuntron
    "914029581610377217", # HTX_Global
    "2371575838", # sibeleth
    "1527020295059648513", # HyperliquidX
    "984188226826010624", # Uniswap
    "9615352", # dwr
    "910110294625492992", # kucoincom
    "2446024556", # Tradermayne
    "2235729541", # dogecoin
    "887748030304329728", # TheCryptoDog
    "1572090499229487104", # ellipsis_labs
    "1456327895866314753", # Tree_of_Alpha
    "1061321268379746304", # nunooeu
    "2880164201", # smithiio
    "2199868461", # Euris_JT
    "2926713453", # ohbrox
    "86647812", # Ga__ke
    "1189381231198134272", # CookerFlips
    "1762266425589149696",# daumeneth
    "1121406190309847046", # 404flipped
    "1392124029914566666", # metaversejoji
]
    
    G = load_graph_data(DB_PATH, rebuild=True)
    scores = calculate_personalized_pagerank(G, seed_nodes=SEED_NODES)
    results = analyze_results(G, scores)
    print(results.head(30))

if __name__ == "__main__":
    main()