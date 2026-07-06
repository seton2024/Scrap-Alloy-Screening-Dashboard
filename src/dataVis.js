/*
* Data Visualization - Framework
* Copyright (C) University of Passau
*   Faculty of Computer Science and Mathematics
*   Chair of Cognitive sensor systems
* Maintenance:
*   2025, Alexander Gall <alexander.gall@uni-passau.de>
*
* All rights reserved.
*/

// scatterplot axes
let xAxis, yAxis, xAxisLabel, yAxisLabel;
// radar chart axes
let radarAxes, radarAxesAngle;

let dimensions = ["dimension 1", "dimension 2", "dimension 3", "dimension 4", "dimension 5", "dimension 6"];
//*HINT: the first dimension is often a label; you can simply remove the first dimension with
// dimensions.splice(0, 1);

// the visual channels we can use for the scatterplot
let channels = ["scatterX", "scatterY", "size"];

// size of the plots
let margin, width, height, radius;
// svg containers
let scatter, radar, dataTable;

// creating memory list for selected items in the radar chart
let selectedItems = [];
const MaxSelections = 5; // limit the number of selected items 
const colorPalette = ["#8A2CE1", "#008003", "#FFA503", "#FB0205", "#4976AF"]; // predefining a color palette for up to 5 selected items

let x, y, r;
let data;
let tooltip;

function init() {
    // define size of plots
    margin = {top: 20, right: 20, bottom: 20, left: 50};
    width = 600;
    height = 500;
    radius = width / 2;

    // Start at default tab
    document.getElementById("defaultOpen").click();

	// data table
	dataTable = d3.select('#dataTable');
 
    // scatterplot SVG container and axes
    scatter = d3.select("#sp").append("svg")
        .attr("width", width)
        .attr("height", height)
        .append("g");

    // tooltip
    tooltip = d3.select("body")
        .append("div")
        .attr("class", "tooltip")
        .style("display", "none");

    // radar chart SVG container and axes
    radar = d3.select("#radar").append("svg")
        .attr("width", width)
        .attr("height", height)
        .append("g")
        .attr("transform", "translate(" + (width / 2) + "," + (height / 2) + ")");

    // read and parse input file
    let fileInput = document.getElementById("upload"), readFile = function () {

        // clear existing visualizations
        clear();

        let reader = new FileReader();
        reader.onloadend = function () {
            console.log("data loaded: ");
            console.log(reader.result);
            //parse raw CSV text into an array of objects, where the header row is used as object keys
            data =d3.csvParse(reader.result, function(row){
                //for each row quant data string to num 
                for (let key in row){
                    if(!isNaN(+row[key]) && row[key] !== ""){
                        row[key] = +row[key];
                    }
                }
                return row;
            });

            // dim array only with num values
            dimensions = [];
            for (let key in data[0]){
                if(typeof data[0][key] === "number"){
                    dimensions.push(key);
                }
            }

            console.log("parsed data: ", data);
            console.log("dimensions: ", dimensions);

            // TODO: parse reader.result data and call the init functions with the parsed data!
            initVis(data);
            CreateDataTable(data);

            initDashboard(data);
        };
        reader.readAsBinaryString(fileInput.files[0]);
    };
    fileInput.addEventListener('change', readFile);
}


function initVis(_data){

    // TODO: parse dimensions (i.e., attributes) from input file


    // y scalings for scatterplot
    // TODO: set y domain for each dimension
    y = d3.scaleLinear()
        .range([height - margin.bottom, margin.top]);

    // x scalings for scatter plot
    // TODO: set x domain for each dimension
    x = d3.scaleLinear()
        .range([margin.left, width - margin.right]);

    // radius scalings for radar chart
    // TODO: set radius domain for each dimension
    r = d3.scaleSqrt()
        .range([2, 12]);

    // scatterplot axes
    yAxis = scatter.append("g")
        .attr("class", "axis")
        .attr("transform", "translate(" + margin.left + ")")
        .call(d3.axisLeft(y));

    yAxisLabel = yAxis.append("text")
        .style("text-anchor", "middle")
        .attr("y", margin.top / 2)
        .text("x");

    xAxis = scatter.append("g")
        .attr("class", "axis")
        .attr("transform", "translate(0, " + (height - margin.bottom) + ")")
        .call(d3.axisBottom(x));

    xAxisLabel = xAxis.append("text")
        .style("text-anchor", "middle")
        .attr("x", width - margin.right)
        .text("y");

    // radar chart axes
    radarAxesAngle = Math.PI * 2 / dimensions.length;
    let axisRadius = d3.scaleLinear()
        .range([0, radius]);
    let maxAxisRadius = 0.75,
        textRadius = 0.8;
    gridRadius = 0.1;

    // radar axes
    radarAxes = radar.selectAll(".axis")
        .data(dimensions)
        .enter()
        .append("g")
        .attr("class", "axis");

    radarAxes.append("line")
        .attr("x1", 0)
        .attr("y1", 0)
        .attr("x2", function(d, i){ return radarX(axisRadius(maxAxisRadius), i); })
        .attr("y2", function(d, i){ return radarY(axisRadius(maxAxisRadius), i); })
        .attr("class", "line")
        .style("stroke", "black")
        
        
    radar.selectAll(".gridCircl")    
        .data(d3.range(gridRadius, maxAxisRadius, gridRadius))
        .enter()
        .append("polygon")
        .attr("points", function(d) {
            return dimensions.map(function(dim,i){
                return [radarX(axisRadius(d), i), radarY(axisRadius(d), i)].join(",");
            }).join(" ");

        })
        .attr("class", "gridPolygon")
        .style("fill", "none")
        .style("stroke", "lightgray");

    radar.selectAll(".axisLabel")
        .data(dimensions)
        .enter()
        .append("text")
        .attr("text-anchor", "middle")
        .attr("dy", "0.35em")
        .attr("x", function(d, i){ return radarX(axisRadius(textRadius), i); })
        .attr("y", function(d, i){ return radarY(axisRadius(textRadius), i); })
        .text(function(d){ return d; });

    // init menu for the visual channels
    channels.forEach(function(c){
        initMenu(c, dimensions);
    });

    // refresh all select menus
    channels.forEach(function(c){
        refreshMenu(c);
    });

    renderScatterplot();
    renderRadarChart();
}

// clear visualizations before loading a new file
function clear(){
    selectedItems = []; // clear selection memory
    scatter.selectAll("*").remove();
    radar.selectAll("*").remove();
    dataTable.selectAll("*").remove();
}

//Create Table
function CreateDataTable(_data) {
            let table = dataTable.append("table").attr("class", "dataTableClass");
            let header = table.append("thead").append("tr");
            _data.columns.forEach(function(column) {
                header.append("th").text(column).attr("class", "tableHeaderClass");
            });
            let body = table.append("tbody");
            _data.forEach(function(row) {
                let tr = body.append("tr");
                _data.columns.forEach(function(column) {
                    tr.append("td").text(row[column]).attr("class", "tableBodyClass");
                });
            });
            console.log(table);

}
function renderScatterplot(){

    //read menu selections

    let dimX= readMenu("scatterX");
    let dimY= readMenu("scatterY");
    let dimSize= readMenu("size"); 

    //set x,y,r scales
    let xData = data.filter(function(d){ return typeof d[dimX] === "number"; });
    let xMin = d3.min(xData, function(d){ return d[dimX]; });
    let xMax = d3.max(xData, function(d){ return d[dimX]; });
    x.domain([xMin, xMax + (xMax - xMin) * 0.1]);

    let yData = data.filter(function(d){ return typeof d[dimY] === "number"; });
    let yMin = d3.min(yData, function(d){ return d[dimY]; });
    let yMax = d3.max(yData, function(d){ return d[dimY]; });
    y.domain([yMin, yMax + (yMax - yMin) * 0.1]);

    let rData = data.filter(function(d){ return typeof d[dimSize] === "number"; });
    let rMin = d3.min(rData, function(d){ return d[dimSize]; });
    let rMax = d3.max(rData, function(d){ return d[dimSize]; });
    r.domain([rMin, rMax + (rMax - rMin) * 0.1]);


    //redraw axes
    xAxis.transition().duration(600).call(d3.axisBottom(x));
    yAxis.transition().duration(600).call(d3.axisLeft(y));

    //update axis labels
    xAxisLabel.text(dimX);
    yAxisLabel.text(dimY);

    //remove lld dots
    // scatter.selectAll(".dot").remove();

    //draw one cicle per data
    let dots = scatter.selectAll('.dot')
        .data(data)
        .join('circle')
        .on('mouseover', function(event, d) {
            let html = data.columns.map(function(col) {
                return "<b>" + col + ":</b> " + d[col];
            }).join("<br>");
            tooltip.style("display", "block").html(html);
        })
        .on('mousemove', function(event) {
            tooltip.style("left", (event.pageX + 10) + "px")
                .style("top", (event.pageY - 28) + "px");
        })
        .on('mouseout', function() {
            tooltip.style("display", "none");
        })
        .attr('class', 'dot')
        .on('click', function(event, d) {
            let idx = selectedItems.indexOf(d);
            if (idx >= 0) { // second click: deselect
                selectedItems[idx] = null;
                renderScatterplot();
                renderRadarChart();
                return;
            }
            if (selectedItems.filter(i => i !== null).length >= MaxSelections) return;
            let slot = selectedItems.indexOf(null);
            if (slot >= 0) {
                selectedItems[slot] = d;
            } else {
                selectedItems.push(d);
            }
            renderRadarChart();
            renderScatterplot();
        });

        // animation of all visual attributes
        dots.transition()
            .duration(600) // we set a duration 600 ms for the transition to make it smooth
            .attr('cx', function(d){ return x(d[dimX]); }) // update the x and y coordinates as well as the radius of each dot based on the current menu selections and the corresponding scales
            .attr('cy', function(d){ return y(d[dimY]); }) // we use the x and y scales to map the data values for the selected dimensions to pixel coordinates on the scatterplot
            .attr('r', function(d){ return r(d[dimSize]); }) // we use the r scale to map the data values for the selected size dimension to circle radii
            .style("fill", function(d) { // set fill color based on selection status
                let idx = selectedItems.indexOf(d);
                if (idx >= 0) return colorPalette[idx]; // if selected, use corresponding color from palette
                return "#000000"; // if not selected, use default gray color
            })
            .style("opacity", function(d) { // set opacity based on selection status
                return selectedItems.indexOf(d) >= 0 ? 1 : 0.5;
            });
}

function renderRadarChart(){

    // find the name column (the one that is not in dimensions)
    let nameColumn = data.columns.find(col => !dimensions.includes(col));

    // takes the legend div from the HTML
    let legend = d3.select("#legend");
    legend.html("<b>Legend:</b><br>");

    selectedItems.forEach(function(item, idx){
        if (item === null) return; // skip empty slots in the selection list

        let entry = legend.append("div");

        entry.append("span")
            .attr("class", "color-circle")
            .style("background-color", colorPalette[idx]);

        entry.append("span")
            .style("margin-left", "6px")
            .text(item[nameColumn]);

        entry.append("span") //
            .attr("class", "close") // add button after the name
            .text("x")
            
            .on("click", function() { // we attach a click listener to the button
                selectedItems[idx] = null; // replace this item with the null at its exact position. The slot still wont be removed - just empties that
                renderScatterplot(); // update scatterplot to reflect deselection
                renderRadarChart(); // update legend to reflect deselection
            })
    });

    // TODO: render polylines in a unique color
    // remove old radar lines and endpoint dots before redawing
    radar.selectAll(".radarLine").remove();

    // loop through all selected items
    selectedItems.forEach(function(item, idx){
        if (item === null) return; // skip empty slots in the selection list

        //draw the polygon line connecting all dimension values for this item
        radar.append("polygon")
            .attr("class", "radarLine")
            .attr("points", dimensions.map(function(dim, i){

                let scale = d3.scaleLinear() // we create a temporary scale to map the value of this dimension for the current item to the radius of the radar chart
                    .domain(d3.extent(data, function(d){ return d[dim]; })) // the domain is set to the extent of this dimension across all data items
                    .range([0, radius * 0.75]); // the range is set to the maximum radius we want to use for the radar chart
                return [radarX(scale(item[dim]), i), radarY(scale(item[dim]), i)].join(","); // we calculate the x and y coordinates for this dimension value using the radarX and radarY functions and return them as a string
            }).join(" ")) // we join the coordinates for all dimensions into a single string that defines the points of the polygon
            .style("fill", "none")
            .style("stroke", colorPalette[idx]) // set stroke color based on selection index
            .style("stroke-width", "2px") // set stroke width
            .style("opacity", 0.8); // set opacity

    // draw one small circle at each point where the line meets an axis
    dimensions.forEach(function(dim, i){
        let scale = d3.scaleLinear() // we create a temporary scale to map the value of this dimension for the current item to the radius of the radar chart
            .domain(d3.extent(data, function(d){ return d[dim]; })) // the domain is set to the extent of this dimension across all data items
            .range([0, radius * 0.75]); // the range is set to the maximum radius we want to use for the radar chart
        radar.append("circle")
            .attr("class", "radarLine")
            .attr("cx", radarX(scale(item[dim]), i))
            .attr("cy", radarY(scale(item[dim]), i))
            .attr("r", 4)
            .style("fill", colorPalette[idx]) // set fill color based on selection index
    });

});
}

function radarX(radius, index){
    return radius * Math.cos(radarAngle(index));
}

function radarY(radius, index){
    return radius * Math.sin(radarAngle(index));
}

function radarAngle(index){
    return radarAxesAngle * index - Math.PI / 2;
}

// init scatterplot select menu
function initMenu(id, entries) {
    $("select#" + id).empty();

    entries.forEach(function (d) {
        $("select#" + id).append("<option>" + d + "</option>");
    });

    $("#" + id).selectmenu({
        select: function () {
            renderScatterplot();
        }
    });
}

// refresh menu after reloading data
function refreshMenu(id){
    $( "#"+id ).selectmenu("refresh");
}

// read current scatterplot parameters
function readMenu(id){
    return $( "#" + id ).val();
    let dimX= readMenu("scatterX");
    let dimY= readMenu("scatterY");
    let dimSize= readMenu("size");

    x.domain(d3.extent(data, function(d){ return d[dimX]; })).nice();
    y.domain(d3.extent(data, function(d){ return d[dimY]; })).nice();
    r.domain(d3.extent(data, function(d){ return d[dimSize]; })).nice();
}

// switches and displays the tabs
function openPage(pageName,elmnt,color) {
    var i, tabcontent, tablinks;
    tabcontent = document.getElementsByClassName("tabcontent");
    for (i = 0; i < tabcontent.length; i++) {
        tabcontent[i].style.display = "none";
    }
    tablinks = document.getElementsByClassName("tablink");
    for (i = 0; i < tablinks.length; i++) {
        tablinks[i].style.backgroundColor = "";
    }
    document.getElementById(pageName).style.display = "block";
    elmnt.style.backgroundColor = color;
}

