import sys
import os
from pathlib import Path
import pandas as pd

if hasattr(sys.stdout, 'reconfigure'):
    sys.stdout.reconfigure(encoding='utf-8')
if hasattr(sys.stderr, 'reconfigure'):
    sys.stderr.reconfigure(encoding='utf-8')

# Add projek aplikasi omi to sys.path
OMI_ROOT = Path("c:/projek aplikasi omi")
if str(OMI_ROOT) not in sys.path:
    sys.path.insert(0, str(OMI_ROOT))


from src.pareto_engine import calculate_pareto

def run_tests():
    print("--- Running Tier 1: Feature 11 (R4.1 Pareto Boundary Crossing Fix) ---")

    # Test 11.1: Boundary crossing item crossing 80% boundary is strictly Class A
    # Total revenue = 1000. Item 1 = 790 (79%), Item 2 = 20 (cum: 81%, prev: 79%), Item 3 = 190
    df = pd.DataFrame([
        {'plu': '001', 'name': 'Item 1', 'sales_amount': 790.0, 'qty_sold': 10, 'qty_stock': 5, 'unit_price': 79},
        {'plu': '002', 'name': 'Boundary Item', 'sales_amount': 20.0, 'qty_sold': 5, 'qty_stock': 5, 'unit_price': 4},
        {'plu': '003', 'name': 'Item 3', 'sales_amount': 150.0, 'qty_sold': 5, 'qty_stock': 5, 'unit_price': 30},
        {'plu': '004', 'name': 'Item 4', 'sales_amount': 40.0, 'qty_sold': 5, 'qty_stock': 5, 'unit_price': 8}
    ])
    res = calculate_pareto(df)
    
    # Sorted order should be Item 1 (790), Item 3 (150), Item 4 (40), Boundary Item (20)
    # Total = 1000.
    # Item 1: 790 / 1000 = 79.0% -> prev 0.0% -> Class A
    # Item 3: 150 -> cum 940 (94.0%) -> prev 79.0% < 80.0% -> MUST BE Class A!
    # Item 4: 40 -> cum 980 (98.0%) -> prev 94.0% >= 80.0% and < 95.0% -> Class B
    # Boundary Item: 20 -> cum 1000 (100.0%) -> prev 98.0% >= 95.0% -> Class C

    item3_class = res.loc[res['name'] == 'Item 3', 'pareto_class'].iloc[0]
    assert item3_class == 'A', f"Case 11.1 Failed: Item 3 (crossing 80%) expected 'A', got '{item3_class}'"
    print("  ✔ Case 11.1: Boundary crossing item (prev_cum_pct < 80.0) is strictly classified as Class A")

    # Test 11.2: Item starting at or after 80% boundary is Class B
    item4_class = res.loc[res['name'] == 'Item 4', 'pareto_class'].iloc[0]
    assert item4_class == 'B', f"Case 11.2 Failed: Item 4 expected 'B', got '{item4_class}'"
    print("  ✔ Case 11.2: Subsequent item (prev_cum_pct >= 80.0 and < 95.0) classified as Class B")

    # Test 11.3: Boundary crossing item for Class B (crossing 95% threshold) is Class B
    # Sorted descending by sales:
    # 1. 700 (70.0%, prev 0.0%) -> Class A
    # 2. 150 (85.0%, prev 70.0%) -> Class A (crosses 80%)
    # 3. 90 (94.0%, prev 85.0%) -> Class B
    # 4. 40 (98.0%, prev 94.0%) -> Class B (crosses 95%)
    # 5. 20 (100.0%, prev 98.0%) -> Class C
    df_b = pd.DataFrame([
        {'plu': '01', 'name': 'A_Dominant', 'sales_amount': 700.0, 'qty_sold': 1, 'qty_stock': 10, 'unit_price': 700},
        {'plu': '02', 'name': 'A_Cross_80', 'sales_amount': 150.0, 'qty_sold': 1, 'qty_stock': 10, 'unit_price': 150},
        {'plu': '03', 'name': 'B_Standard', 'sales_amount': 90.0, 'qty_sold': 1, 'qty_stock': 10, 'unit_price': 90},
        {'plu': '04', 'name': 'B_Cross_95', 'sales_amount': 40.0, 'qty_sold': 1, 'qty_stock': 10, 'unit_price': 40},
        {'plu': '05', 'name': 'C_Standard', 'sales_amount': 20.0, 'qty_sold': 1, 'qty_stock': 10, 'unit_price': 20}
    ])
    res_b = calculate_pareto(df_b)
    b_cross_class = res_b.loc[res_b['name'] == 'B_Cross_95', 'pareto_class'].iloc[0]
    assert b_cross_class == 'B', f"Case 11.3 Failed: B_Cross_95 expected 'B', got '{b_cross_class}'"
    print("  ✔ Case 11.3: Item crossing 95% boundary is classified as Class B")

    # Test 11.4: Item starting after 95% boundary is Class C
    c1_class = res_b.loc[res_b['name'] == 'C_Standard', 'pareto_class'].iloc[0]
    assert c1_class == 'C', f"Case 11.4 Failed: C_Standard expected 'C', got '{c1_class}'"
    print("  ✔ Case 11.4: Item with prev_cum_pct >= 95.0 classified as Class C")


    # Test 11.5: Zero sales items are strictly Class C
    df_zero = pd.DataFrame([
        {'plu': 'Z1', 'name': 'Active Product', 'sales_amount': 1000.0, 'qty_sold': 10, 'qty_stock': 10, 'unit_price': 100},
        {'plu': 'Z2', 'name': 'Dead Stock Product', 'sales_amount': 0.0, 'qty_sold': 0, 'qty_stock': 10, 'unit_price': 0}
    ])
    res_zero = calculate_pareto(df_zero)
    z2_class = res_zero.loc[res_zero['plu'] == 'Z2', 'pareto_class'].iloc[0]
    assert z2_class == 'C', f"Case 11.5 Failed: Zero sales item expected 'C', got '{z2_class}'"
    print("  ✔ Case 11.5: Items with zero sales amount are strictly classified as Class C")


    return {"passed": 5, "failed": 0, "feature": "Feature 11 (R4.1 Pareto Boundary Crossing Fix)"}

if __name__ == "__main__":
    result = run_tests()
    print("Feature 11 result:", result)
