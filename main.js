'use strict';

const lodash = require('lodash');
const util = require('util');
const chalk = require('chalk');
const CheckTypes = require('check-types');
const process = require('process');

class Time{
	constructor(value, unit = 'sec'){
		this.value = value;
		this.unit = unit;
	}
	toString(){
		return `${this.value}${this.unit}`;
	}
	convertTo(unit){
		const factor = this.getFactor(new Time(this.value, unit));
		return new Time(this.value * factor, unit);
	}
	static getTimeFactor(unit){
		return ({
			tick: 1,
			sec: 60,
			min: 60 * 60,
		})[unit];
	}
	getFactor(otherTime){
		return (this.value * Time.getTimeFactor(this.unit)) / (otherTime.value * Time.getTimeFactor(otherTime.unit));
	}
}

class Building {
	constructor(name, speed, size, maxItems, type){
		this.name = name;
		this.speed = speed;
		this.size = size;
		if (typeof maxItems == 'undefined') {
			this.maxItems = Infinity;
		} else {
			this.maxItems = maxItems;
		}
		this.type = type;
	}
}

class PipedBuilding extends Building {
	constructor(name, speed, size, pipes) {
		super(name, speed, size);
		this.pipes = pipes;
	}
}

class BuildingType {
	constructor(name, buildings) {
		const obj = {
			name,
			buildings,
		};
		console.log(obj)
		if (CheckTypes.not.like(obj, {
			name: '',
			buildings: [new Building()],
		})) {
			console.error(`Wrong args for initing BuildingType ${name}:`, obj);
			process.exit(1);
		}
		this.name = name;
		this.buildings = buildings;
		buildings.forEach(v => v.type = this);
	}
}

class Item {
	constructor(name, craftPlace) {
		this.name = name;
		this.craftPlace = craftPlace;
	}
}

class Recipe {
	constructor(name, fromDesc, toDesc, buildingType, time) {
		const obj = {
			name,
			fromDesc,
			toDesc,
			buildingType,
			time,
		};
		console.log(obj)
		if (CheckTypes.not.like(obj, {
			name: '',
			fromDesc: [new IOGroup()],
			toDesc: [new IOGroup()],
			time: 0,
			buildingType: new BuildingType('', []),
		})) {
			console.error(`Wrong args for initing Recipe ${name}:`, obj);
			process.exit(1);
		}
		this.name = name;
		this.from = fromDesc;
		this.to = toDesc;
		this.time = time;
	}

	toCount(item){
		return lodash.find(this.to, v => v.item === item).count;
	}
	fromCount(item){
		return lodash.find(this.from, v => v.item === item).count;
	}
}

class IOGroup {
	constructor(item, count){
		this.item = item;
		this.count = count;
	}
	clone(){
		return new IOGroup(this.item, this.count);
	}

	getRecipes(){
		return lodash.filter(
			recipes,
			recipeDescription => lodash.find(recipeDescription.to, element => element.item === this.item)
		);
	}

	resolveInputs() {
		const okRecipes = this.getRecipes();
		if (okRecipes.length == 0) {
			//			console.error(`No recipe OK for ${this.item.name}`);
			return new IOGroupList(this);
		}
		if (okRecipes.length > 1)
			console.error(`More than 1 recipe OK for ${this.item.name}`);
		const okRecipe = okRecipes[0];
		var transformFactor = 1 / lodash.find(okRecipe.to, element => element.item === this.item).count;

		const requirements = new IOGroupList(lodash(okRecipe.from).map(
			element => new IOGroup(element.item, element.count * transformFactor)
		).map(
			factorElement => {
				factorElement.count *= this.count;
				return factorElement;
			}
		).value());
		this.recipe = [okRecipe];
		return requirements;
	}

	resolveDeep() {
		return new IOGroupList(this).resolveDeep();
	}
	treeDeep() {
		return new IOGroupList(this).treeDeep();
	}
	tree() {
		return new IOGroupList(this).tree();
	}
}

class IOGroupList extends Array {
	constructor(...args) {
		if ( args.length === 1 && args[0] instanceof Array ) {
			super(...args[0]);	
		} else {
			super(...args);
		}

		return new Proxy(this, {
			get: function (target, name) {
				var len = target.length;
				if (typeof name === 'string' && /^-?\d+$/.test(name))
					return target[(name % len + len) % len];
				return target[name];
			}
		});
	}

	resolveAllInputs() {
		const inputsEach = lodash(this).map( value => value.resolveInputs()).value();
		const inputsSum = lodash.reduce(inputsEach, (accumulator, subList) => {
			lodash.forEach(subList, value => {
				let target = lodash.find(accumulator, v => v.item == value.item);
				if (target) {
					target.count += value.count;
					if(value.recipe)
						target.recipe = lodash(target.recipe).push(value.recipe).uniq().value();
				} else {
					accumulator.push(value);
				}
			});
			return accumulator;
		}, new IOGroupList());
		return inputsSum;
	}

	tree() {
		function treeDeep(value){
			const clone = value.clone();
			const resolved = value.resolveInputs();
			if (!lodash.isEqual(new IOGroupList(clone), resolved)) {
				clone.children = lodash(resolved).map( treeDeep ).value()
			} else {
				//				clone.children = resolved;
			}
			return clone;
		}

		const inputsEach = lodash(this).map( treeDeep ).value();
		return inputsEach;
	}
	resolveDeep() {
		let resolveIterations = [this];
		let count = 0;
		while (count == 0 || (count < 1000 && !lodash.isEqual(resolveIterations[count - 1], resolveIterations[count]))) {
			resolveIterations.push(resolveIterations[count].resolveAllInputs());
			count++;
		}
		resolveIterations.pop();
		return resolveIterations;
	}
}

class BuildingSetup {
	constructor(config){
		for(var i in buildingTypes){
			if(config.hasOwnProperty(i)) {
				this[i] = config[i];
			} else {
				this[i] = buildingTypes[i].buildings;
			}
		}
	}

	getBuildingsForProduction(desiredOutput, time) {
		const desiredOutputs = desiredOutput instanceof IOGroupList ? desiredOutput : new IOGroupList(desiredOutput);
		const inputs = desiredOutputs.resolveAllInputs();
		const buildingsList = desiredOutputs.reduce( (acc, v) => {
			let recipeDuration = NaN;
			if(!v.recipe || v.recipe.length != 1) {
				// No recipe, this is a primary
				return acc;
			}
			const recipe = v.recipe[0];
			if(!v.recipe)
				console.warn(`No recipe retrieved for ${v.item.name} in BuildingSetup.getBuildingsForProduction`);
			else if(v.recipe.length != 1)
				console.warn(`Errors recipes retrieved for ${v.item.name} in BuildingSetup.getBuildingsForProduction: ${v.recipe}`);
			else
				recipeDuration = recipe.time;
			const allowedBuildings = lodash.intersection(v.item.craftPlace.buildings, this[v.item.craftPlace.name]);
			console.log(allowedBuildings, recipe);
			const building = lodash(allowedBuildings).sortBy(['speed']).value()[0];
			acc.push({
				building,
				recipe,
				count: (recipeDuration.getFactor(time) * v.count) / (building.speed * recipe.toCount(v.item))
			});
			return acc;
		}, []);
		return {
			buildingsList,
			inputs, 
		};
	}

	getBuildingsForProductionDeep(desiredOutput, time) {
		const doRecurse = desiredOutput => {
			const firstRes = this.getBuildingsForProduction(desiredOutput, time);
			//		console.log(util.inspect(firstRes, 5));
			if(!lodash.isEqual(firstRes.inputs, desiredOutput)) {
				const recurseContent = lodash(doRecurse(firstRes.inputs)).flatten().compact().value();
				return [firstRes].concat(recurseContent);
			} else {
				return [];
			}
		}

		const deepSearch = doRecurse(desiredOutput);
		const sum = deepSearch.reduce( (accumulator, recurseValue ) => {
			recurseValue.inputs.forEach(recursionPropValue => {
				let target = lodash.find(accumulator.inputs, v => v.item == recursionPropValue.item);
				if (target) {
					target.count += recursionPropValue.count;
					if(recursionPropValue.recipe)
						target.recipe = lodash(target.recipe).push(recurseValue.recipe).uniq().value();
				} else {
					accumulator.inputs.push(recursionPropValue);
				}
			});
			recurseValue.buildingsList.forEach(recursionPropValue => {
				let target = lodash.find(accumulator.buildingsList, v => v.recipe == recursionPropValue.recipe && v.building == recursionPropValue.building);
				if (target) {
					target.count += recursionPropValue.count;
				} else {
					accumulator.buildingsList.push(recursionPropValue);
				}
			});
			return accumulator;
		}, {
			buildingsList: [],
			inputs: new IOGroupList(),
		});
		return sum;
	}
}

class Debit {
	constructor(count, time) {
		this.rawCount = count;
		this.rawTime = time;

		// Set per-sec
		const secTime = time.convertTo('sec');
		const factor = time.getFactor(secTime);
		secTime.value /= count;
		this.count = 1;
		this.time = secTime;
	}
	per(unit) {
		return this.during(new Time(1, unit));
	}
	during(time){
		return this.count / this.time.getFactor(time);
	}
}

class BeltSetup {
	constructor(debit, undergroundLength){
		this.debit = debit;
		this.undergroundLength = undergroundLength;
	}
}

const belts = {
	transport_belt: new BeltSetup(new Debit(800, new Time(1, 'min')), 5),
	fast_belt: new BeltSetup(new Debit(1600, new Time(1, 'min')), 7),
	express_belt: new BeltSetup(new Debit(2400, new Time(1, 'min')), 9),
}

const buildings = {
	assembling_machine_1: new Building('Assembling machine 1', 0.75, [3,3], 2),
	assembling_machine_2: new Building('Assembling machine 2', 1, [3,3], 4),
	assembling_machine_3: new Building('Assembling machine 3', 1.25, [3,3], Infinity),
	chemical_plant: new Building('Chemical plant', 1.25, [3,3]),
	stone_furnace: new Building('Stone furnace', 1, [2, 2]),
	steel_furnace: new Building('Steel furnace', 2, [2, 2]),
	electric_furnace: new Building('Electric furnace', 2, [2, 2]),
	oil_refinery: new Building('Oil refinery', 1, [5, 5]),
}

const buildingTypes = {
	assembling_machines: new BuildingType('assembling_machines', [
		buildings.assembling_machine_1,
		buildings.assembling_machine_2,
		buildings.assembling_machine_3,
	]),
	chemical_plants: new BuildingType('chemical_plants', [
		buildings.chemical_plant
	]),
	furnaces: new BuildingType('furnaces', [
		buildings.stone_furnace,
		buildings.steel_furnace,
		buildings.electric_furnace,
	]),
	refineries: new BuildingType('refineries', [
		buildings.oil_refinery,
	]),
}

const items = {
	coal: new Item('Coal'),
	stone: new Item('Stone'),
	copper_ore: new Item('Copper Ore'),
	iron_ore: new Item('Iron Ore'),

	copper: new Item('Copper plate', buildingTypes.furnaces),
	iron: new Item('Iron plate', buildingTypes.furnaces),

	steel: new Item('Steel', buildingTypes.furnaces),
	stone_brick: new Item('Stone brick', buildingTypes.furnaces),

	iron_gear: new Item('Iron gear', buildingTypes.assembling_machines),
	copper_cable: new Item('Copper cable', buildingTypes.assembling_machines),
	electric_mining_drill: new Item('Electric mining drill', buildingTypes.assembling_machines),
	plastic_bar: new Item('Plastic bar', buildingTypes.chemical_plants),
	pipe: new Item('Pipe', buildingTypes.assembling_machines),
	sulfur: new Item('Sulfur', buildingTypes.chemical_plants),
	battery: new Item('Battery', buildingTypes.assembling_machines),
	engine_unit: new Item('Engine unit', buildingTypes.assembling_machines),
	electric_engine_unit: new Item('Electric engine unit', buildingTypes.assembling_machines),

	speed_module_1: new Item('Speed module 1', buildingTypes.assembling_machines),

	water: new Item('Water'),
	petroleum: new Item('Petroleum'),
	petroleum_gas: new Item('Petroleum gas', buildingTypes.refineries),
	light_oil: new Item('Light oil', buildingTypes.refineries),
	heavy_oil: new Item('Heavy oil', buildingTypes.refineries),
	lubricant: new Item('Lubricant', buildingTypes.chemical_plants),
	sulfuric_acid: new Item('Sulfuric acid', buildingTypes.chemical_plants),

	assembling_machine_1: new Item('Assembling machine 1', buildingTypes.assembling_machines),

	electric_furnace: new Item('Electric furnace', buildingTypes.assembling_machines),

	belt_1: new Item('Transport belt', buildingTypes.assembling_machines),

	inserter: new Item('Inserter', buildingTypes.assembling_machines),
	inserter_long: new Item('Long handed inserter', buildingTypes.assembling_machines),

	grenade: new Item('Grenade', buildingTypes.assembling_machines),
	firearm_magazine: new Item('Firearm magazine', buildingTypes.assembling_machines),
	piercing_rounds_magazine: new Item('Piercing rounds magazine', buildingTypes.assembling_machines),

	gun_turret: new Item('Gun turret', buildingTypes.assembling_machines),

	electronic_circuit: new Item('Electronic circuit', buildingTypes.assembling_machines),
	advanced_circuit: new Item('Advanced circuit', buildingTypes.assembling_machines),
	processing_unit: new Item('Processing unit', buildingTypes.assembling_machines),

	science_pack_1: new Item('Science pack 1', buildingTypes.assembling_machines),
	science_pack_2: new Item('Science pack 2', buildingTypes.assembling_machines),
	science_pack_3: new Item('Science pack 3', buildingTypes.assembling_machines),
	science_pack_military: new Item('Military science pack', buildingTypes.assembling_machines),
	science_pack_productivity: new Item('Productivity science pack', buildingTypes.assembling_machines),
	science_pack_high_tech: new Item('High tech science pack', buildingTypes.assembling_machines),
};

const recipes = {
	copper: new Recipe('Copper plate', [
		new IOGroup(items.copper_ore, 1),
	], [
		new IOGroup(items.copper, 1),
	], new Time(3.5, 'sec')),
	iron: new Recipe('Iron plate', [
		new IOGroup(items.iron_ore, 1),
	], [
		new IOGroup(items.iron, 2),
	], new Time(3.5, 'sec')),
	copper_cable: new Recipe('Copper cable', [
		new IOGroup(items.copper, 1),
	], [
		new IOGroup(items.copper_cable, 2),
	], new Time(0.5, 'sec')),
	electronic_circuit: new Recipe('Electronic circuit', [
		new IOGroup(items.copper_cable, 3),
		new IOGroup(items.iron, 1),
	], [
		new IOGroup(items.electronic_circuit, 1),
	], new Time(0.5, 'sec')),
	iron_gear: new Recipe('Iron gear', [
		new IOGroup(items.iron, 2),
	], [
		new IOGroup(items.iron_gear, 1),
	], new Time(0.5, 'sec')),
	belt_1: new Recipe('Transport belt', [
		new IOGroup(items.iron_gear, 1),
		new IOGroup(items.iron, 1),
	], [
		new IOGroup(items.belt_1, 2),
	], new Time(0.5, 'sec')),
	inserter: new Recipe('Inserter', [
		new IOGroup(items.iron_gear, 1),
		new IOGroup(items.iron, 1),
		new IOGroup(items.electronic_circuit, 1),
	], [
		new IOGroup(items.inserter, 1),
	], new Time(0.5, 'sec')),
	inserter_long: new Recipe('Long handed inserter', [
		new IOGroup(items.iron_gear, 1),
		new IOGroup(items.iron, 1),
		new IOGroup(items.inserter, 1),
	], [
		new IOGroup(items.inserter_long, 1),
	], new Time(0.5, 'sec')),
	science_pack_1: new Recipe('Science pack 1', [
		new IOGroup(items.iron_gear, 1),
		new IOGroup(items.copper, 1),
	], [
		new IOGroup(items.science_pack_1, 1),
	], new Time(5, 'sec')),
	science_pack_2: new Recipe('Science pack 2', [
		new IOGroup(items.inserter, 1),
		new IOGroup(items.belt_1, 1),
	], [
		new IOGroup(items.science_pack_2, 1),
	], new Time(6, 'sec')),
	science_pack_3: new Recipe('Science pack 3', [
		new IOGroup(items.advanced_circuit, 1),
		new IOGroup(items.engine_unit, 1),
		new IOGroup(items.electric_mining_drill, 1),
	], [
		new IOGroup(items.science_pack_3, 1),
	], new Time(12, 'sec')),
	advanced_circuit: new Recipe('Advanced circuit', [
		new IOGroup(items.electronic_circuit, 2),
		new IOGroup(items.plastic_bar, 2),
		new IOGroup(items.copper_cable, 4),
	], [
		new IOGroup(items.advanced_circuit, 1),
	], new Time(6, 'sec')),
	electric_mining_drill: new Recipe('Electric mining drill', [
		new IOGroup(items.electronic_circuit, 3),
		new IOGroup(items.iron_gear, 5),
		new IOGroup(items.iron, 10),
	], [
		new IOGroup(items.electric_mining_drill, 1),
	], new Time(2, 'sec')),
	plastic_bar: new Recipe('Plastic bar', [
		new IOGroup(items.coal, 1),
		new IOGroup(items.petroleum_gas, 20),
	], [
		new IOGroup(items.plastic_bar, 2),
	], new Time(1, 'sec')),
	piercing_rounds_magazine: new Recipe('Piercing rounds magazine', [
		new IOGroup(items.steel, 1),
		new IOGroup(items.copper, 5),
		new IOGroup(items.firearm_magazine, 1),
	], [
		new IOGroup(items.piercing_rounds_magazine, 1),
	], new Time(3, 'sec')),
	firearm_magazine: new Recipe('Firearm magazine', [
		new IOGroup(items.iron, 4),
	], [
		new IOGroup(items.firearm_magazine, 1),
	], new Time(1, 'sec')),
	science_pack_military: new Recipe('Military science pack', [
		new IOGroup(items.grenade, 1),
		new IOGroup(items.piercing_rounds_magazine, 1),
		new IOGroup(items.gun_turret, 1),
	], [
		new IOGroup(items.science_pack_military, 2),
	], new Time(10, 'sec')),
	grenade: new Recipe('Grenade', [
		new IOGroup(items.iron, 5),
		new IOGroup(items.coal, 10),
	], [
		new IOGroup(items.grenade, 1),
	], new Time(8, 'sec')),
	gun_turret: new Recipe('Gun turret', [
		new IOGroup(items.iron, 20),
		new IOGroup(items.iron_gear, 10),
		new IOGroup(items.copper, 10),
	], [
		new IOGroup(items.gun_turret, 1),
	], new Time(8, 'sec')),
	steel: new Recipe('Steel', [
		new IOGroup(items.iron, 5),
	], [
		new IOGroup(items.steel, 1),
	], new Time(17.5, 'sec')),
	science_pack_productivity: new Recipe('Production science pack', [
		new IOGroup(items.electric_furnace, 1),
		new IOGroup(items.assembling_machine_1, 1),
		new IOGroup(items.electric_engine_unit, 1),
	], [
		new IOGroup(items.science_pack_productivity, 2),
	], new Time(14, 'sec')),
	electric_furnace: new Recipe('Electric furnace', [
		new IOGroup(items.advanced_circuit, 5),
		new IOGroup(items.steel, 10),
		new IOGroup(items.stone_brick, 10),
	], [
		new IOGroup(items.electric_furnace, 1),
	], new Time(5, 'sec')),
	electric_engine_unit: new Recipe('Electric engine unit', [
		new IOGroup(items.engine_unit, 1),
		new IOGroup(items.electronic_circuit, 2),
		new IOGroup(items.lubricant, 15),
	], [
		new IOGroup(items.electric_engine_unit, 1),
	], new Time(10, 'sec')),
	engine_unit: new Recipe('Engine unit', [
		new IOGroup(items.steel, 1),
		new IOGroup(items.iron_gear, 1),
		new IOGroup(items.pipe, 2),
	], [
		new IOGroup(items.engine_unit, 1),
	], new Time(10, 'sec')),
	pipe: new Recipe('Pipe', [
		new IOGroup(items.iron, 1),
	], [
		new IOGroup(items.pipe, 1),
	], new Time(0.5, 'sec')),
	assembling_machine_1: new Recipe('Assembling machine 1', [
		new IOGroup(items.electronic_circuit, 3),
		new IOGroup(items.iron_gear, 5),
		new IOGroup(items.iron, 9),
	], [
		new IOGroup(items.assembling_machine_1, 1),
	], new Time(0.5, 'sec')),
	stone_brick: new Recipe('Stone brick', [
		new IOGroup(items.stone, 2),
	], [
		new IOGroup(items.stone_brick, 1),
	], new Time(3.5, 'sec')),
	science_pack_high_tech: new Recipe('High tech science pack', [
		new IOGroup(items.battery, 1),
		new IOGroup(items.copper_cable, 30),
		new IOGroup(items.processing_unit, 3),
		new IOGroup(items.speed_module_1, 1),
	], [
		new IOGroup(items.science_pack_high_tech, 2),
	], new Time(14, 'sec')),
	sulfuric_acid: new Recipe('Sulfuric acid', [
		new IOGroup(items.copper, 1),
		new IOGroup(items.iron, 1),
		new IOGroup(items.sulfuric_acid, 20),
	], [
		new IOGroup(items.battery, 1),
	], new Time(5, 'sec')),
	speed_module_1: new Recipe('Speed module', [
		new IOGroup(items.electronic_circuit, 5),
		new IOGroup(items.advanced_circuit, 5),
	], [
		new IOGroup(items.speed_module_1, 1),
	], new Time(15, 'sec')),
	processing_unit: new Recipe('Speed module', [
		new IOGroup(items.electronic_circuit, 20),
		new IOGroup(items.advanced_circuit, 2),
		new IOGroup(items.sulfuric_acid, 5),
	], [
		new IOGroup(items.processing_unit, 1),
	], new Time(10, 'sec')),
	sulfur: new Recipe('Sulfur', [
		new IOGroup(items.petroleum_gas, 30),
		new IOGroup(items.water, 30),
	], [
		new IOGroup(items.sulfur, 2),
	], new Time(1, 'sec')),
	sulfuric_acid: new Recipe('Sulfuric acid', [
		new IOGroup(items.sulfur, 5),
		new IOGroup(items.water, 100),
		new IOGroup(items.iron, 1),
	], [
		new IOGroup(items.sulfuric_acid, 50),
	], new Time(1, 'sec')),
	basic_oil_processing: new Recipe('Basic oil processing', [
		new IOGroup(items.petroleum, 10),
	], [
		new IOGroup(items.light_oil, 3),
		new IOGroup(items.heavy_oil, 3),
		new IOGroup(items.petroleum_gas, 4),
	], new Time(5, 'sec')),
	battery: new Recipe('Battery', [
		new IOGroup(items.iron, 1),
		new IOGroup(items.copper, 1),
		new IOGroup(items.sulfuric_acid, 20),
	], [
		new IOGroup(items.battery, 1),
	], new Time(5, 'sec')),
};

const displaySet = {
	simple: {
		last: ['└', '├'],
		children: ['┬', '>'],
		more: '|',
		padd: '─',
	},
	double: {
		last: ['╚', '╠'],
		children: ['╦', '>'],
		more: '║',
		padd: '═',
	},
};

function formatStrDigits(nbr){
	const LEN = 4;
	var str = nbr.toLocaleString(undefined, {
		maximumFractionDigits: 2,
		minimumFractionDigits: 0,
	});
	return ' '.repeat(Math.max(0, LEN - str.length)) + str;
}
function outputTree(tree, set = displaySet.double, padding = 1){
	function outputTree(prefix, value, index, arr){
		var l = set.last[index == arr.length - 1 ? 0 : 1 ];
		var c = set.children[value.children && value.children.length > 0 ? 0 : 1 ];
		function stilyze(str){
			return chalk.red(str);
		}
		console.log(`${prefix}${stilyze(`${l}${set.padd.repeat(padding - 1)}${c}`)} (${chalk.bold(formatStrDigits(value.count))}) ${value.item.craftPlace ? value.item.name : chalk.cyan(value.item.name)}`);
		lodash.forEach(value.children, outputTree.bind(null, prefix + chalk.red(l == set.last[0] ? ' ' : set.more) + (' '.repeat(padding - 1))));
	}

	lodash.forEach(tree, outputTree.bind(null, ''));
}
function displayResults(goal){
	outputTree(goal.tree(), undefined, 2);
	const resolutions = goal.resolveDeep();
	const sum = lodash.last(resolutions);
	console.log('Need: ');
	sum.forEach( v => console.log(`${chalk.bold(formatStrDigits(v.count))} ${v.item.name}`))
}
function displayBuildingsList(buildingsList){
	buildingsList.buildingsList.forEach(v => {
		console.log(`${formatStrDigits(v.count)} ${chalk.bold(v.building.name)} for ${v.recipe.name}`);
	})
}

//console.log('Resolve iron * 25', new IOGroup(items.iron, 25).resolveInputs());
//console.log('Resolve copper_cable * 25', new IOGroup(items.copper_cable, 25).resolveInputs());
//onsole.log('Resolve electronic_circuits * 25', new IOGroup(items.electronic_circuit, 25).resolveInputs());
//console.log('Resolve electronic_circuits * 25 deeply', new IOGroup(items.electronic_circuit, 25).resolveInputs().resolveAllInputs());
//console.log('Resolve belt_1 * 25 deeply', new IOGroup(items.belt_1, 2).resolveDeep());
//displayResults(new IOGroup(items.science_pack_2, 1));

console.log(new Time(1, 'sec'));
console.log(new Time(1, 'sec').convertTo('tick'));
console.log(new Time(1, 'min').getFactor(new Time(1, 'sec')));
console.log(new Time(1, 'min').getFactor(new Time(2, 'min')));
console.log(new Time(1, 'tick').convertTo('min'));
console.log(new Time(1, 'min').convertTo('tick'));
console.log(new Debit(1, new Time(1, 'sec')));
console.log(new Debit(1, new Time(2, 'sec')));
console.log(new Debit(60, new Time(1, 'min')));
console.log(new Debit(60, new Time(1, 'min')).per('min'));
console.log(new Debit(1, new Time(1, 'tick')).per('min'));
console.log(new Debit(1, new Time(2, 'tick')).per('min'));
console.log(new Debit(1, new Time(1, 'min')).per('tick'));
console.log(new Debit(60, new Time(1, 'min')).during(new Time(2, 'min')));
console.log(...lodash.toArray(belts));
//return;

const setup = new BuildingSetup({
	assembling_machines: [buildings.assembling_machine_2],
	chemical_plants: [buildings.chemical_plant],
	furnaces: [buildings.electric_furnace],
});

/*const target = new IOGroupList([
	new IOGroup(items.science_pack_1, 1),
	new IOGroup(items.science_pack_2, 1),
	new IOGroup(items.science_pack_3, 1),
]);*/
const target = new IOGroupList([
	//	new IOGroup(items.science_pack_1, 1),
	//	new IOGroup(items.science_pack_2, 1),
	//	new IOGroup(items.science_pack_3, 1),
	//	new IOGroup(items.science_pack_military, 1),
	//	new IOGroup(items.science_pack_productivity, 1),
	new IOGroup(items.science_pack_high_tech, 1),
]);
//displayBuildingsList(setup.getBuildingsForProductionDeep(target, new Time(1, 'sec')));
//console.log("============")
displayBuildingsList(setup.getBuildingsForProductionDeep(target, new Time(1, 'sec')));
displayResults(target);
//		console.log(util.inspect(desiredOutput, false, null))