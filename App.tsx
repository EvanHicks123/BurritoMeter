import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
    StyleSheet, Text, View, TextInput, TouchableOpacity,
    KeyboardAvoidingView, Platform, useWindowDimensions,
    Alert, ScrollView, Animated, Easing, Modal
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FontAwesome5, MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';

// ─── Constants ────────────────────────────────────────────────────────────────
const BURRITO_GOAL = 14.00;
const GOOGLE_API_KEY = 'AIzaSyCSpbBW1sZr9meQCKtDdkV3r1tPzFGWQeA';
const PROXY = 'https://corsproxy.io/?';

const C = {
    bg:           '#101820', // Midnight Blue
    surface:      '#192734',
    surfaceHigh:  '#161618',
    border:       'rgba(255,255,255,0.06)',
    blue:         '#87CEEB', // Sky Blue
    gold:         '#EFC050', // Saanich Gold
    goldDim:      'rgba(239,192,80,0.12)',
    white:        '#F0F6FF',
    whiteSub:     'rgba(240,246,255,0.55)',
    whiteMuted:   'rgba(240,246,255,0.22)',
    danger:       '#F87171',
    inputBg:      '#0d141b',
};

// ─── Web helpers ──────────────────────────────────────────────────────────────
const webGrad = (colors: string[], deg = 135): object =>
    Platform.OS === 'web' ? { background: `linear-gradient(${deg}deg, ${colors.join(', ')})` } : { backgroundColor: colors[0] };

const webBoxShadow = (shadow: string): object =>
    Platform.OS === 'web' ? { boxShadow: shadow } : {};

const webOnly = (css: object): object => Platform.OS === 'web' ? css : {};

const injectWebAssets = () => {
    if (Platform.OS !== 'web') return;
    const doc = (globalThis as any).document;
    if (!doc) return;
    if (!doc.getElementById('bm-global')) {
        const el = doc.createElement('style');
        el.id = 'bm-global';
        el.textContent = `input { outline: none !important; caret-color: #EFC050; } ::-webkit-scrollbar { width: 0; }`;
        doc.head.appendChild(el);
    }
};
injectWebAssets();

// ─── Animated Counter ─────────────────────────────────────────────────────────
function AnimatedCounter({ anim }: { anim: Animated.Value }) {
    const [display, setDisplay] = useState('$0.00');
    useEffect(() => {
        const id = anim.addListener(({ value: v }) => {
            const formatted = (v < 0 ? '-' : '') + '$' + Math.abs(v).toFixed(2);
            setDisplay(formatted);
        });
        return () => anim.removeListener(id);
    }, [anim]);
    return <Text style={S.metricValue}>{display}</Text>;
}

// ─── Hover Component (FIXED HITBOX) ───────────────────────────────────────────
function HoverPress({ onPress, style, children }: { onPress?: () => void; style?: object | object[]; children: React.ReactNode; }) {
    const scale = useRef(new Animated.Value(1)).current;
    const spring = (toVal: number) => Animated.spring(scale, { toValue: toVal, useNativeDriver: true }).start();
    return (
        // Moved the width to the outer view, and the padding/colors to the TouchableOpacity
        <Animated.View style={{ transform: [{ scale }], width: '100%' }}>
            <TouchableOpacity activeOpacity={0.85} onPress={onPress} onPressIn={() => spring(0.97)} onPressOut={() => spring(1)} style={style}>
                {children}
            </TouchableOpacity>
        </Animated.View>
    );
}

// ─── Main App ────────────────────────────────────────────────────────────────
export default function App() {
    const [efficiency, setEfficiency] = useState('6.3');
    const [gasPrice,   setGasPrice]   = useState('2.15');
    const [totalOwed,  setTotalOwed]  = useState(0);
    const [totalPaidOut, setTotalPaidOut] = useState(0);
    const [loading,    setLoading]    = useState(false);

    // Modals
    const [settleVisible, setSettleVisible] = useState(false);
    const [resetVisible,  setResetVisible]  = useState(false);
    const [subtractVisible, setSubtractVisible] = useState(false);

    // Inputs
    const [origin, setOrigin] = useState('');
    const [destination, setDestination] = useState('');
    const [subtractAmount, setSubtractAmount] = useState('');

    // Modifiers
    const [roundTrip, setRoundTrip] = useState(false);
    const [tripCount, setTripCount] = useState(1);

    // Dropdowns
    const [originSuggestions, setOriginSuggestions] = useState<any[]>([]);
    const [destSuggestions, setDestSuggestions] = useState<any[]>([]);

    const animTotal = useRef(new Animated.Value(0)).current;
    const animProgress = useRef(new Animated.Value(0)).current;
    const originAnim = useRef(new Animated.Value(0)).current;
    const destAnim = useRef(new Animated.Value(0)).current;

    const { width, height } = useWindowDimensions();

    useEffect(() => {
        // Load Total Debt
        AsyncStorage.getItem('@burrito_debt').then(saved => {
            if (saved !== null) {
                const val = parseFloat(saved);
                setTotalOwed(val);
                animTotal.setValue(val);
                const clamped = Math.max(0, val);
                animProgress.setValue((clamped % BURRITO_GOAL) / BURRITO_GOAL);
            }
        });

        // Load Total Paid Out
        AsyncStorage.getItem('@burrito_paid').then(saved => {
            if (saved !== null) {
                setTotalPaidOut(parseFloat(saved));
            }
        });
    }, [animTotal, animProgress]);

    const runAnimations = useCallback((newTotal: number) => {
        const clampedTotal = Math.max(0, newTotal);
        const newProg = (clampedTotal % BURRITO_GOAL) / BURRITO_GOAL;

        Animated.timing(animProgress, {
            toValue: newProg,
            duration: 1400,
            easing: Easing.bezier(0.4, 0, 0.2, 1),
            useNativeDriver: false
        }).start();
        Animated.timing(animTotal, {
            toValue: newTotal,
            duration: 1200,
            easing: Easing.out(Easing.exp),
            useNativeDriver: false
        }).start();
    }, [animProgress, animTotal]);

    const toggleDrop = (anim: Animated.Value, show: boolean) =>
        Animated.timing(anim, { toValue: show ? 1 : 0, duration: 210, useNativeDriver: true }).start();

    const fetchSuggestions = async (text: string, setFn: (v: any[]) => void, anim: Animated.Value) => {
        if (text.length < 3) { setFn([]); toggleDrop(anim, false); return; }
        try {
            const url = `${PROXY}${encodeURIComponent(`https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${text}&components=country:ca&key=${GOOGLE_API_KEY}`)}`;
            const res = await fetch(url);
            const data: any = await res.json();
            if (data.predictions?.length > 0) { setFn(data.predictions); toggleDrop(anim, true); }
        } catch (error) { console.error(error); }
    };

    const calculateAndSave = async (km: number) => {
        // 1. Double distance if "There and Back" is checked
        const finalKm = roundTrip ? km * 2 : km;

        // 2. Calculate the raw total cost of the gas
        const totalGasCost = (finalKm / parseFloat(efficiency)) * parseFloat(gasPrice);

        // 3. Take your 65% share
        const myShare = totalGasCost * 0.65;

        // 4. Multiply by the number of trips (defaults to 1)
        const finalCost = myShare * tripCount;

        const next = totalOwed + finalCost;
        setTotalOwed(next);
        runAnimations(next);
        await AsyncStorage.setItem('@burrito_debt', next.toString());

        // Reset everything for the next trip
        setOrigin('');
        setDestination('');
        setRoundTrip(false);
        setTripCount(1);
        setOriginSuggestions([]);
        setDestSuggestions([]);
    };

    const handleAddTrip = async () => {
        const manual = parseFloat(origin);
        if (!isNaN(manual) && !destination) { await calculateAndSave(manual); return; }
        if (!origin || !destination) { Alert.alert('Hold up!', 'Input needed.'); return; }
        setLoading(true);
        try {
            const apiUrl = `https://maps.googleapis.com/maps/api/distancematrix/json?origins=${encodeURIComponent(origin)}&destinations=${encodeURIComponent(destination)}&key=${GOOGLE_API_KEY}`;
            const res = await fetch(`${PROXY}${encodeURIComponent(apiUrl)}`);
            const data: any = await res.json();
            if (data.status === 'OK' && data.rows[0].elements[0].status === 'OK') {
                await calculateAndSave(data.rows[0].elements[0].distance.value / 1000);
            }
        } catch { Alert.alert('Error', 'Check connection.'); } finally { setLoading(false); }
    };

    const handleSettle = async () => {
        const next = totalOwed - BURRITO_GOAL;
        const nextPaid = totalPaidOut + BURRITO_GOAL;

        setTotalOwed(next);
        setTotalPaidOut(nextPaid);
        runAnimations(next);

        await AsyncStorage.setItem('@burrito_debt', next.toString());
        await AsyncStorage.setItem('@burrito_paid', nextPaid.toString());
        setSettleVisible(false);
    };

    const handleCustomSubtract = async () => {
        const cleanAmount = subtractAmount.replace(/[^0-9.]/g, '');
        const amount = parseFloat(cleanAmount);

        if (isNaN(amount) || amount <= 0) {
            Alert.alert("Invalid Amount", "Please enter a valid number to subtract.");
            return;
        }

        const next = totalOwed - amount;
        const nextPaid = totalPaidOut + amount;

        setTotalOwed(next);
        setTotalPaidOut(nextPaid);
        runAnimations(next);

        await AsyncStorage.setItem('@burrito_debt', next.toString());
        await AsyncStorage.setItem('@burrito_paid', nextPaid.toString());
        setSubtractVisible(false);
        setSubtractAmount('');
    };

    const handleReset = async () => {
        setTotalOwed(0);
        animTotal.setValue(0);
        animProgress.setValue(0);
        setTotalPaidOut(0);

        await AsyncStorage.removeItem('@burrito_debt');
        await AsyncStorage.removeItem('@burrito_paid');
        setResetVisible(false);
    };

    const visualTotal = Math.max(0, totalOwed);
    const burritoCount = Math.floor(visualTotal / BURRITO_GOAL);
    const progressInCurrent = visualTotal % BURRITO_GOAL;
    const barWidth = animProgress.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

    return (
        <View style={[S.shell, { height: Platform.OS === 'web' ? '100vh' as any : height }]}>
            <KeyboardAvoidingView behavior="padding" style={{ flex: 1 }}>
                <ScrollView contentContainerStyle={S.scroll} keyboardShouldPersistTaps="always" showsVerticalScrollIndicator={false}>
                    <View style={[S.card, { width: Math.min(width * 0.94, 520) }, webBoxShadow('0 8px 32px rgba(0,0,0,0.5)')]}>
                        <View style={S.header}>
                            <View><Text style={S.eyebrow}>FUEL DEBT TRACKER</Text><Text style={S.appTitle}>Burrito·Meter</Text></View>
                            <View style={S.headerRight}>
                                <AnimatedCounter anim={animTotal} />
                                <Text style={S.debtLabel}>Total Owed</Text>
                                <Text style={S.paidLabel}>Total Paid: ${totalPaidOut.toFixed(2)}</Text>
                            </View>
                        </View>

                        <View style={S.trackCard}>
                            <View style={S.row}>
                                <View style={S.trackEnd}><FontAwesome5 name="house-user" size={16} color={C.blue} /><Text style={S.trackEndLabel}>HOME</Text></View>
                                <View style={S.trackBarWrap}>
                                    <View style={S.trackBg}><Animated.View style={[S.trackFill, { width: barWidth }, webGrad([C.blue, C.gold])] } /></View>
                                    <View style={S.rowBetween}><Text style={S.barLabelLeft}>${progressInCurrent.toFixed(2)}</Text><Text style={S.barLabelRight}>${BURRITO_GOAL.toFixed(2)}</Text></View>
                                </View>
                                <View style={S.trackEnd}><MaterialCommunityIcons name="taco" size={18} color={C.gold} /><Text style={S.trackEndLabel}>GOAL</Text></View>
                            </View>
                        </View>

                        <View style={S.shelf}>
                            <View style={S.burritoGrid}>
                                {Array.from({ length: burritoCount }).map((_, i) => (
                                    <TouchableOpacity key={i} onPress={() => setSettleVisible(true)} style={S.burritoChip}>
                                        <MaterialCommunityIcons name="taco" size={24} color={C.gold} />
                                    </TouchableOpacity>
                                ))}
                                <TouchableOpacity onPress={() => setSubtractVisible(true)} style={[S.burritoChip, S.plusChip]}>
                                    <MaterialCommunityIcons name="plus" size={24} color={C.whiteMuted} />
                                </TouchableOpacity>
                            </View>
                            {burritoCount === 0 && <Text style={[S.emptyText, { marginTop: 12 }]}>Add trips to earn a taco</Text>}
                        </View>

                        <View style={S.inputSection}>
                            <View style={[S.inputGroup, { zIndex: 3 }]}>
                                <Text style={S.label}>ORIGIN</Text>
                                <TextInput style={S.fintechInput} value={origin} onChangeText={t => { setOrigin(t); fetchSuggestions(t, setOriginSuggestions, originAnim); }} onBlur={() => setTimeout(() => { setOriginSuggestions([]); toggleDrop(originAnim, false); }, 180)} placeholder="Starting Point..." placeholderTextColor={C.whiteMuted} />
                                {originSuggestions.length > 0 && (
                                    <Animated.View style={[S.dropdown, { opacity: originAnim }]}>{originSuggestions.map(item => (
                                        <TouchableOpacity key={item.place_id} style={S.dropdownItem} onPress={() => { setOrigin(item.description); setOriginSuggestions([]); toggleDrop(originAnim, false); }}><Text style={S.dropdownText}>{item.description}</Text></TouchableOpacity>
                                    ))}</Animated.View>
                                )}
                                <TouchableOpacity onPress={() => setOrigin('2276 Arbutus Road, Victoria, BC')} style={S.shortcut}><Text style={S.shortcutText}>🏠 Peter's House</Text></TouchableOpacity>
                            </View>

                            <View style={[S.inputGroup, { zIndex: 2 }]}>
                                <Text style={S.label}>DESTINATION</Text>
                                <TextInput style={S.fintechInput} value={destination} onChangeText={t => { setDestination(t); fetchSuggestions(t, setDestSuggestions, destAnim); }} onBlur={() => setTimeout(() => { setDestSuggestions([]); toggleDrop(destAnim, false); }, 180)} placeholder="Where to?" placeholderTextColor={C.whiteMuted} />
                                {destSuggestions.length > 0 && (
                                    <Animated.View style={[S.dropdown, { opacity: destAnim }]}>{destSuggestions.map(item => (
                                        <TouchableOpacity key={item.place_id} style={S.dropdownItem} onPress={() => { setDestination(item.description); setDestSuggestions([]); toggleDrop(destAnim, false); }}><Text style={S.dropdownText}>{item.description}</Text></TouchableOpacity>
                                    ))}</Animated.View>
                                )}
                            </View>

                            <View style={S.row}>
                                <View style={[S.inputGroup, { flex: 1, marginRight: 8 }]}><Text style={S.label}>km/L</Text><TextInput style={S.fintechInput} value={efficiency} onChangeText={setEfficiency} keyboardType="numeric" /></View>
                                <View style={[S.inputGroup, { flex: 1, marginLeft: 8 }]}><Text style={S.label}>Gas $/L</Text><TextInput style={S.fintechInput} value={gasPrice} onChangeText={setGasPrice} keyboardType="numeric" /></View>
                            </View>

                            {/* Trip Multipliers Row */}
                            <View style={S.optionsRow}>
                                <TouchableOpacity activeOpacity={0.8} onPress={() => setRoundTrip(!roundTrip)} style={S.checkboxRow}>
                                    <View style={[S.checkbox, roundTrip && S.checkboxActive]}>
                                        {roundTrip && <MaterialCommunityIcons name="check" size={16} color="#000" />}
                                    </View>
                                    <Text style={S.checkboxLabel}>There and back</Text>
                                </TouchableOpacity>

                                <View style={S.stepperContainer}>
                                    <Text style={S.stepperLabel}>TRIPS</Text>
                                    <View style={S.stepper}>
                                        <TouchableOpacity onPress={() => setTripCount(Math.max(1, tripCount - 1))} style={S.stepperBtn}>
                                            <MaterialCommunityIcons name="minus" size={14} color={C.white} />
                                        </TouchableOpacity>
                                        <Text style={S.stepperValue}>x{tripCount}</Text>
                                        <TouchableOpacity onPress={() => setTripCount(tripCount + 1)} style={S.stepperBtn}>
                                            <MaterialCommunityIcons name="plus" size={14} color={C.white} />
                                        </TouchableOpacity>
                                    </View>
                                </View>
                            </View>
                        </View>

                        <HoverPress onPress={handleAddTrip} style={S.cta}><Text style={S.ctaText}>{loading ? 'Calculating…' : 'Log Trip'}</Text></HoverPress>
                        <TouchableOpacity onPress={() => setResetVisible(true)} style={S.resetRow}><Ionicons name="trash-outline" size={12} color={C.whiteMuted} /><Text style={S.resetText}> Nuclear Reset</Text></TouchableOpacity>
                    </View>
                </ScrollView>
            </KeyboardAvoidingView>

            {/* Settle Burrito Modal */}
            <Modal transparent visible={settleVisible} animationType="fade">
                <View style={S.modalOverlay}><View style={[S.modalCard, webOnly({ backdropFilter: 'blur(8px)' })]}>
                    <Text style={S.modalTitle}>Settle Debt</Text><Text style={S.modalBody}>Bought the burrito? Resolves ${BURRITO_GOAL.toFixed(2)}.</Text>
                    <View style={S.row}>
                        <TouchableOpacity style={[S.modalBtn, { flex: 1, marginRight: 6 }]} onPress={handleSettle}><Text style={S.modalBtnText}>Yes</Text></TouchableOpacity>
                        <TouchableOpacity style={[S.modalBtn, { flex: 1, marginLeft: 6, backgroundColor: '#222' }]} onPress={() => setSettleVisible(false)}><Text style={S.modalBtnText}>No</Text></TouchableOpacity>
                    </View>
                </View></View>
            </Modal>

            {/* Custom Subtract Modal */}
            <Modal transparent visible={subtractVisible} animationType="fade">
                <View style={S.modalOverlay}><View style={[S.modalCard, webOnly({ backdropFilter: 'blur(8px)' })]}>
                    <Text style={S.modalTitle}>Custom Deduct</Text><Text style={S.modalBody}>Subtract a specific dollar amount.</Text>
                    <TextInput
                        style={[S.fintechInput, { width: '100%', marginBottom: 20, textAlign: 'center', fontSize: 20 }]}
                        value={subtractAmount}
                        onChangeText={setSubtractAmount}
                        keyboardType="numeric"
                        placeholder="$0.00"
                        placeholderTextColor={C.whiteMuted}
                        autoFocus
                    />
                    <View style={S.row}>
                        <TouchableOpacity style={[S.modalBtn, { flex: 1, marginRight: 6 }]} onPress={handleCustomSubtract}><Text style={S.modalBtnText}>Subtract</Text></TouchableOpacity>
                        <TouchableOpacity style={[S.modalBtn, { flex: 1, marginLeft: 6, backgroundColor: '#222' }]} onPress={() => { setSubtractVisible(false); setSubtractAmount(''); }}><Text style={S.modalBtnText}>Cancel</Text></TouchableOpacity>
                    </View>
                </View></View>
            </Modal>

            {/* Reset Modal */}
            <Modal transparent visible={resetVisible} animationType="fade">
                <View style={S.modalOverlay}><View style={S.modalCard}>
                    <Text style={[S.modalTitle, { color: C.danger }]}>Reset System</Text><Text style={S.modalBody}>Wipe everything? No undo.</Text>
                    <View style={S.row}>
                        <TouchableOpacity style={[S.modalBtn, { flex: 1, marginRight: 6, backgroundColor: C.danger }]} onPress={handleReset}><Text style={S.modalBtnText}>Wipe</Text></TouchableOpacity>
                        <TouchableOpacity style={[S.modalBtn, { flex: 1, marginLeft: 6, backgroundColor: '#222' }]} onPress={() => setResetVisible(false)}><Text style={S.modalBtnText}>Back</Text></TouchableOpacity>
                    </View>
                </View></View>
            </Modal>
        </View>
    );
}

const S = StyleSheet.create({
    shell: { backgroundColor: C.bg, width: '100%' },
    scroll: { flexGrow: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 32 },
    card: { backgroundColor: C.surface, borderRadius: 28, padding: 28, borderWidth: 1, borderColor: C.border },
    header: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 28 },
    eyebrow: { fontSize: 9, letterSpacing: 2, color: C.whiteMuted, marginBottom: 5 },
    appTitle: { fontSize: 24, fontWeight: '800', color: C.white },
    headerRight: { alignItems: 'flex-end' },
    metricValue: { fontSize: 32, fontWeight: 'bold', color: C.gold },
    debtLabel: { fontSize: 9, color: C.whiteMuted, marginTop: 3 },
    paidLabel: { fontSize: 10, color: C.blue, marginTop: 5, fontWeight: '700' },
    trackCard: { backgroundColor: C.surfaceHigh, borderRadius: 20, padding: 20, marginBottom: 18 },
    row: { flexDirection: 'row', alignItems: 'center' },
    rowBetween: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 },
    trackEnd: { alignItems: 'center', width: 52 },
    trackEndLabel: { fontSize: 8, color: C.whiteMuted, marginTop: 6 },
    trackBarWrap: { flex: 1, marginHorizontal: 14 },
    trackBg: { height: 10, backgroundColor: '#000', borderRadius: 10, overflow: 'hidden' },
    trackFill: { height: '100%', borderRadius: 10, backgroundColor: C.gold, position: 'absolute' },
    barLabelLeft: { fontSize: 11, color: C.blue },
    barLabelRight: { fontSize: 11, color: C.whiteMuted },
    shelf: { backgroundColor: C.surfaceHigh, borderRadius: 20, padding: 18, marginBottom: 18, minHeight: 88, justifyContent: 'center', alignItems: 'center' },
    emptyText: { color: C.whiteMuted, fontSize: 13 },
    burritoGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 10 },
    burritoChip: { backgroundColor: C.goldDim, borderRadius: 12, padding: 12, borderWidth: 1, borderColor: 'rgba(239,192,80,0.2)' },
    plusChip: { backgroundColor: 'rgba(255,255,255,0.03)', borderColor: 'rgba(255,255,255,0.08)' },
    inputSection: { marginBottom: 20 },
    inputGroup: { marginBottom: 16 },
    label: { fontSize: 9, color: C.whiteMuted, marginBottom: 8, textTransform: 'uppercase' },
    fintechInput: { backgroundColor: C.inputBg, color: C.white, padding: 15, borderRadius: 14, borderWidth: 1, borderColor: C.border },
    dropdown: { position: 'absolute', top: 70, left: 0, right: 0, backgroundColor: '#0F1929', borderRadius: 14, zIndex: 100 },
    dropdownItem: { padding: 13, borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.04)' },
    dropdownText: { color: C.whiteSub, fontSize: 13 },
    shortcut: { marginTop: 10 },
    shortcutText: { color: C.blue, fontSize: 12, fontWeight: '800' },

    // Checkbox and Stepper Styles
    optionsRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 12, marginBottom: 8 },
    checkboxRow: { flexDirection: 'row', alignItems: 'center' },
    checkbox: { width: 22, height: 22, borderRadius: 6, borderWidth: 1, borderColor: C.whiteMuted, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
    checkboxActive: { backgroundColor: C.gold, borderColor: C.gold },
    checkboxLabel: { color: C.whiteSub, fontSize: 13, fontWeight: '600' },
    stepperContainer: { flexDirection: 'row', alignItems: 'center' },
    stepperLabel: { color: C.whiteMuted, fontSize: 10, fontWeight: '700', marginRight: 8, textTransform: 'uppercase' },
    stepper: { flexDirection: 'row', alignItems: 'center', backgroundColor: C.inputBg, borderRadius: 10, borderWidth: 1, borderColor: C.border },
    stepperBtn: { paddingHorizontal: 10, paddingVertical: 8 },
    stepperValue: { color: C.white, fontSize: 13, fontWeight: '700', minWidth: 24, textAlign: 'center' },

    // Log Trip button (padding is now directly on the button to fix the hitbox)
    cta: { borderRadius: 18, padding: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#007BFF', marginBottom: 16 },
    ctaText: { color: '#fff', fontSize: 16, fontWeight: '900' },

    resetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
    resetText: { color: C.whiteMuted, fontSize: 11, textTransform: 'uppercase' },
    modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', justifyContent: 'center', alignItems: 'center' },
    modalCard: { backgroundColor: C.surfaceHigh, padding: 30, borderRadius: 24, width: '85%', alignItems: 'center', borderWidth: 1, borderColor: C.border },
    modalTitle: { color: C.white, fontSize: 20, fontWeight: '900', marginBottom: 10 },
    modalBody: { color: C.whiteSub, fontSize: 14, textAlign: 'center', marginBottom: 20, lineHeight: 20 },
    modalBtn: { padding: 16, borderRadius: 14, backgroundColor: '#007BFF', alignItems: 'center', justifyContent: 'center' },
    modalBtnText: { color: '#fff', fontWeight: '900' },
});